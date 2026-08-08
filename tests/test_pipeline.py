"""Unit and end-to-end tests. Run with: python -m pytest tests -v"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import captions, config, ingest, render, score, segment, transcribe  # noqa: E402
from app.models import Transcript, Word  # noqa: E402

HAS_FFMPEG = shutil.which(config.FFMPEG) is not None


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def make_words(spec: list[tuple[str, float, float]]) -> list[Word]:
    return [Word(text=t, start=s, end=e) for t, s, e in spec]


def speech(sentences: list[str], start: float = 0.0, wps: float = 2.8) -> list[Word]:
    """Lay a list of sentences out on a timeline at a constant speaking rate."""
    words: list[Word] = []
    clock = start
    step = 1.0 / wps
    for sentence in sentences:
        for token in sentence.split():
            words.append(Word(text=token, start=clock, end=clock + step * 0.9))
            clock += step
        clock += 0.6  # pause between sentences
    return words


# --------------------------------------------------------------------------- #
# ingest
# --------------------------------------------------------------------------- #

def test_normalize_url_accepts_bare_id():
    assert ingest.normalize_url("dQw4w9WgXcQ") == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def test_normalize_url_extracts_from_prose():
    raw = "check this out https://youtu.be/abc123XYZ_ it's wild"
    assert ingest.normalize_url(raw) == "https://youtu.be/abc123XYZ_"


def test_normalize_url_strips_trailing_punctuation():
    assert ingest.normalize_url("see https://youtu.be/abc.") == "https://youtu.be/abc"


def test_normalize_url_rejects_empty():
    with pytest.raises(ValueError):
        ingest.normalize_url("   ")


# --------------------------------------------------------------------------- #
# transcript parsing
# --------------------------------------------------------------------------- #

def test_json3_parsing_word_timings(tmp_path: Path):
    payload = {
        "events": [
            {
                "tStartMs": 1000,
                "dDurationMs": 2000,
                "segs": [
                    {"utf8": "hello", "tOffsetMs": 0},
                    {"utf8": " world", "tOffsetMs": 500},
                    {"utf8": " again", "tOffsetMs": 1200},
                ],
            },
            {
                "tStartMs": 3200,
                "dDurationMs": 1000,
                "segs": [{"utf8": "next", "tOffsetMs": 0}],
            },
        ]
    }
    path = tmp_path / "cap.json3"
    path.write_text(json.dumps(payload), encoding="utf-8")

    result = transcribe.from_youtube_json3(path)
    assert [w.text for w in result.words] == ["hello", "world", "again", "next"]
    assert result.words[0].start == pytest.approx(1.0)
    assert result.words[1].start == pytest.approx(1.5)
    assert result.words[2].start == pytest.approx(2.2)
    assert result.words[3].start == pytest.approx(3.2)
    assert result.source == "youtube-captions"


def test_json3_clamps_overlapping_words(tmp_path: Path):
    """Auto-caption events overlap; words must not extend past the next word."""
    payload = {
        "events": [
            {"tStartMs": 0, "dDurationMs": 5000, "segs": [{"utf8": "one", "tOffsetMs": 0}]},
            {"tStartMs": 1000, "dDurationMs": 5000, "segs": [{"utf8": "two", "tOffsetMs": 0}]},
        ]
    }
    path = tmp_path / "cap.json3"
    path.write_text(json.dumps(payload), encoding="utf-8")

    words = transcribe.from_youtube_json3(path).words
    assert words[0].end <= words[1].start
    for word in words:
        assert word.end > word.start


def test_json3_rejects_empty_track(tmp_path: Path):
    path = tmp_path / "cap.json3"
    path.write_text(json.dumps({"events": []}), encoding="utf-8")
    with pytest.raises(RuntimeError):
        transcribe.from_youtube_json3(path)


# --------------------------------------------------------------------------- #
# segmentation
# --------------------------------------------------------------------------- #

def test_units_split_on_pauses_when_unpunctuated():
    words = make_words(
        [("we", 0.0, 0.3), ("went", 0.3, 0.6), ("there", 0.6, 0.9)]
        + [("then", 2.0, 2.3), ("it", 2.3, 2.6), ("broke", 2.6, 2.9)]
    )
    units = segment.build_units(Transcript(words=words, source="youtube-captions"))
    assert len(units) == 2
    assert units[0].text == "we went there"
    assert units[1].gap_before == pytest.approx(1.1)


def test_units_split_on_punctuation():
    words = speech(["This is a full sentence here right now okay then good."] * 3)
    units = segment.build_units(Transcript(words=words, source="whisper"))
    assert len(units) == 3
    assert all(unit.ends_sentence for unit in units)


def test_candidates_respect_duration_bounds():
    words = speech(["one two three four five six seven eight nine ten."] * 40)
    units = segment.build_units(Transcript(words=words, source="whisper"))
    spans = segment.enumerate_candidates(units)
    assert spans, "expected at least one candidate window"
    for i, j in spans:
        duration = units[j].end - units[i].start
        assert config.MIN_CLIP_SECONDS <= duration <= config.MAX_CLIP_SECONDS


def test_suppress_overlaps_removes_near_duplicates():
    from app.models import Candidate

    candidates = [
        Candidate(id="a", start=0, end=30, text="x", score=90),
        Candidate(id="b", start=2, end=31, text="x", score=80),   # ~93% overlap with a
        Candidate(id="c", start=100, end=130, text="x", score=70),
    ]
    kept = segment.suppress_overlaps(candidates, max_results=10)
    assert [c.id for c in kept] == ["a", "c"]


def test_suppress_overlaps_honours_max_results():
    from app.models import Candidate

    candidates = [
        Candidate(id=f"c{i}", start=i * 60, end=i * 60 + 30, text="x", score=100 - i)
        for i in range(10)
    ]
    assert len(segment.suppress_overlaps(candidates, max_results=3)) == 3


# --------------------------------------------------------------------------- #
# scoring
# --------------------------------------------------------------------------- #

def _score(text: str, duration: float = 40.0) -> float:
    from app.models import Candidate

    words = speech([text])
    units = segment.build_units(Transcript(words=words, source="whisper"))
    candidate = Candidate(id="x", start=0.0, end=duration, text=text)
    return score.score_candidate(candidate, units, 0, len(units) - 1).score


def test_hooky_clip_outscores_filler():
    hooky = (
        "Here's the thing nobody tells you about this. I lost three million "
        "dollars in a single afternoon and the worst part is I saw it coming."
    )
    flat = (
        "um so yeah you know we basically kind of like looked at it and it was "
        "sorta fine i guess and then um we moved on to the next thing you know"
    )
    assert _score(hooky) > _score(flat) + 15


def test_dangling_opener_is_penalised():
    clean = "The reason this happened is very simple and it changed everything."
    dangling = "But that is also why it happened and things changed after."
    assert _score(clean) > _score(dangling)


def test_score_is_bounded():
    for text in ["", "a", "shocking insane crazy brutal " * 30]:
        value = _score(text or "x")
        assert 0.0 <= value <= 100.0


def test_title_is_trimmed():
    long_text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen."
    title = score.suggest_title(long_text)
    assert title.endswith("…")
    assert len(title.split()) <= 13
    assert title[0].isupper()


# --------------------------------------------------------------------------- #
# captions
# --------------------------------------------------------------------------- #

def test_ass_colour_is_byte_reversed():
    assert captions._ass_color("#FFE24B") == "&H004BE2FF&"
    assert captions._ass_color("#000000") == "&H00000000&"
    assert captions._ass_color("#FFF") == "&H00FFFFFF&"


def test_ass_colour_rejects_bad_input():
    with pytest.raises(ValueError):
        captions._ass_color("not-a-colour")


def test_ass_timestamp_format():
    assert captions._timestamp(0) == "0:00:00.00"
    assert captions._timestamp(3661.5) == "1:01:01.50"


def test_ass_escapes_braces():
    assert "{" not in captions._escape("a {b} c")
    assert "\\" not in captions._escape("a \\N b")


def test_group_words_breaks_on_gap():
    words = make_words(
        [("a", 0.0, 0.2), ("b", 0.2, 0.4)] + [("c", 1.5, 1.7), ("d", 1.7, 1.9)]
    )
    groups = captions.group_words(words, captions.CaptionStyle(style="pop"))
    assert len(groups) == 2


def test_group_words_respects_character_cap():
    """Long words must not build a phrase wider than the frame."""
    words = speech(["extraordinarily complicated implementation details everywhere"])
    groups = captions.group_words(words, captions.CaptionStyle(style="pop"))
    for group in groups:
        width = sum(len(w.text.strip()) for w in group) + len(group) - 1
        assert width <= captions.GROUP_MAX_CHARS or len(group) == 1


def test_single_style_is_one_word_per_group():
    words = speech(["one two three four five six."])
    groups = captions.group_words(words, captions.CaptionStyle(style="single"))
    assert all(len(g) == 1 for g in groups)
    assert len(groups) == len(words)


def test_build_ass_produces_valid_file(tmp_path: Path):
    words = speech(["This is a test of the caption builder right here."] * 4)
    out = captions.build_ass(
        words, clip_start=2.0, clip_end=10.0, out_path=tmp_path / "c.ass"
    )
    text = out.read_text(encoding="utf-8")

    assert "[Script Info]" in text and "[V4+ Styles]" in text and "[Events]" in text
    assert "PlayResX: 1080" in text and "PlayResY: 1920" in text

    lines = [ln for ln in text.splitlines() if ln.startswith("Dialogue:")]
    assert lines, "expected at least one dialogue line"

    for line in lines:
        fields = line[len("Dialogue: "):].split(",", 9)
        start_s, end_s = fields[1], fields[2]
        assert start_s < end_s, f"non-positive duration in {line}"
        # Timings are relative to the clip, so nothing may exceed its length.
        h, m, rest = end_s.split(":")
        assert int(h) * 3600 + int(m) * 60 + float(rest) <= 8.0 + 0.2


def test_build_ass_only_includes_words_inside_clip(tmp_path: Path):
    words = make_words([("early", 0.0, 0.5), ("inside", 5.0, 5.5), ("late", 60.0, 60.5)])
    out = captions.build_ass(
        words, clip_start=4.0, clip_end=10.0, out_path=tmp_path / "c.ass",
        style=captions.CaptionStyle(uppercase=False),
    )
    text = out.read_text(encoding="utf-8")
    assert "inside" in text
    assert "early" not in text
    assert "late" not in text


def test_build_ass_keeps_single_spaces_between_words(tmp_path: Path):
    """The colour-reset override must not introduce a second space."""
    words = make_words([("alpha", 0.0, 0.3), ("beta", 0.4, 0.7), ("gamma", 0.8, 1.1)])
    out = captions.build_ass(
        words, clip_start=0.0, clip_end=5.0, out_path=tmp_path / "c.ass",
        style=captions.CaptionStyle(uppercase=False),
    )
    import re as _re

    for line in out.read_text(encoding="utf-8").splitlines():
        if not line.startswith("Dialogue:"):
            continue
        body = line[len("Dialogue: "):].split(",", 9)[9]
        visible = _re.sub(r"\{[^}]*\}", "", body)  # strip override blocks
        assert "  " not in visible, f"double space in {visible!r}"
        assert visible == visible.strip(), f"stray edge space in {visible!r}"


def test_build_ass_highlights_one_word_per_line(tmp_path: Path):
    words = speech(["alpha beta gamma delta."])
    out = captions.build_ass(
        words, clip_start=0.0, clip_end=30.0, out_path=tmp_path / "c.ass",
        style=captions.CaptionStyle(accent="#FF0000"),
    )
    accent = captions._ass_color("#FF0000")
    for line in out.read_text(encoding="utf-8").splitlines():
        if line.startswith("Dialogue:"):
            assert line.count(f"\\c{accent}") == 1


# --------------------------------------------------------------------------- #
# render maths
# --------------------------------------------------------------------------- #

def test_output_size_vertical_from_landscape():
    opts = render.RenderOptions(aspect="vertical")
    assert render.output_size(1920, 1080, opts) == (1080, 1920)


def test_output_size_square():
    opts = render.RenderOptions(aspect="square")
    assert render.output_size(1920, 1080, opts) == (1080, 1080)


def test_output_size_original_caps_long_edge_and_stays_even():
    opts = render.RenderOptions(aspect="original")
    w, h = render.output_size(3840, 2160, opts)
    assert max(w, h) == 1920
    assert w % 2 == 0 and h % 2 == 0


def test_escape_for_filter_handles_windows_paths():
    escaped = render.escape_for_filter(r"C:\clips\a,b.ass")
    assert "\\:" in escaped and "\\\\" in escaped and "\\," in escaped


def test_build_video_filter_includes_burn_in():
    filt = render.build_video_filter(1080, 1920, render.RenderOptions(), Path("/tmp/x.ass"))
    assert "ass=" in filt and filt.endswith("[v]")


def test_build_video_filter_omits_burn_in_when_disabled():
    filt = render.build_video_filter(1080, 1920, render.RenderOptions(), None)
    assert "ass=" not in filt


# --------------------------------------------------------------------------- #
# end to end (needs ffmpeg)
# --------------------------------------------------------------------------- #

@pytest.fixture(scope="module")
def sample_video(tmp_path_factory) -> Path:
    """A 40s 1280x720 test pattern with a tone, standing in for a real source."""
    path = tmp_path_factory.mktemp("media") / "sample.mp4"
    subprocess.run(
        [
            config.FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=40",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=40",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest", str(path),
        ],
        check=True,
    )
    return path


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
def test_probe_dimensions(sample_video: Path):
    assert render.probe_dimensions(sample_video) == (1280, 720)


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
def test_render_vertical_clip_with_captions(sample_video: Path, tmp_path: Path):
    words = speech(["Here is the thing nobody tells you about testing video."] * 3, start=5.0)
    ass = captions.build_ass(
        words, clip_start=5.0, clip_end=20.0, out_path=tmp_path / "c.ass",
        style=captions.CaptionStyle(font="DejaVu Sans"),
    )
    out = render.render_clip(
        source=sample_video,
        start=5.0,
        end=20.0,
        out_path=tmp_path / "clip.mp4",
        options=render.RenderOptions(aspect="vertical", captions=True),
        ass_path=ass,
    )

    assert out.exists() and out.stat().st_size > 10_000
    assert render.probe_dimensions(out) == (1080, 1920)

    duration = subprocess.run(
        [config.FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(out)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert 14.0 < float(duration) < 16.0


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
def test_render_blurred_background_variant(sample_video: Path, tmp_path: Path):
    out = render.render_clip(
        source=sample_video,
        start=1.0,
        end=6.0,
        out_path=tmp_path / "blur.mp4",
        options=render.RenderOptions(aspect="vertical_blur", captions=False,
                                     normalize_audio=False),
    )
    assert render.probe_dimensions(out) == (1080, 1920)


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
def test_render_reports_progress(sample_video: Path, tmp_path: Path):
    seen: list[float] = []
    render.render_clip(
        source=sample_video,
        start=0.0,
        end=8.0,
        out_path=tmp_path / "p.mp4",
        options=render.RenderOptions(aspect="square", captions=False),
        on_progress=lambda f, _m: seen.append(f),
    )
    assert seen and max(seen) > 0.3
    assert seen == sorted(seen)


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
def test_render_error_surfaces_message(tmp_path: Path):
    with pytest.raises(render.RenderError):
        render.render_clip(
            source=tmp_path / "does-not-exist.mp4",
            start=0.0,
            end=5.0,
            out_path=tmp_path / "out.mp4",
        )
