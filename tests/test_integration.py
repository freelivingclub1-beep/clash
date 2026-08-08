"""Full pipeline against a local video and a real json3 caption track.

Only the three network calls are stubbed (metadata, caption fetch, download).
Everything downstream — parsing, segmentation, scoring, caption building and the
ffmpeg render — runs for real, including through the HTTP API.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config, ingest, pipeline  # noqa: E402
from app.models import SourceVideo  # noqa: E402

HAS_FFMPEG = shutil.which(config.FFMPEG) is not None
pytestmark = pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")

VIDEO_ID = "testvid0001"

# A monologue with two obvious peaks (a hook + a story) and a flat stretch
# between them, so we can assert the ranker actually discriminates.
SCRIPT = [
    "okay so welcome back to the channel today we are going to talk about a few things",
    "let me get the housekeeping out of the way first there is a link in the description",
    "and if you have not subscribed yet you know what to do it really does help us out",
    "here is the thing nobody tells you about starting a business",
    "I lost four hundred thousand dollars in a single afternoon and the worst part is I saw it coming",
    "I had every warning sign in front of me and I ignored all of them because I was scared",
    "so anyway moving on to the next section of the video which is about the tooling",
    "there are a bunch of options out there and they all kind of do the same thing basically",
    "um you know it really just depends on what you are comfortable with I guess",
    "the biggest mistake people make is thinking that more tools will fix a broken process",
    "I watched a team of forty engineers spend two years building something nobody wanted",
    "and when we finally shipped it we got eleven users total eleven after two years",
    "that failure taught me more than every success I had before it combined honestly",
    "alright that is going to do it for today thanks for watching and I will see you next time",
]


def build_json3(script: list[str], wps: float = 2.7) -> dict:
    """Lay the script out as a YouTube-style json3 caption track."""
    events = []
    clock = 1.0
    for line in script:
        segs = []
        start = clock
        for token in line.split():
            segs.append({"utf8": token, "tOffsetMs": int((clock - start) * 1000)})
            clock += 1.0 / wps
        events.append(
            {
                "tStartMs": int(start * 1000),
                "dDurationMs": int((clock - start) * 1000),
                "segs": segs,
            }
        )
        clock += 0.7  # pause between lines
    return {"events": events}


@pytest.fixture(scope="module")
def staged(tmp_path_factory, module_mocker=None):
    """Create the media + caption artefacts and point ingest at them."""
    work = tmp_path_factory.mktemp("integration")
    captions_json = build_json3(SCRIPT)
    duration = captions_json["events"][-1]["tStartMs"] / 1000 + 10

    media = work / "source.mp4"
    subprocess.run(
        [
            config.FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", f"testsrc2=size=1280x720:rate=25:duration={duration:.0f}",
            "-f", "lavfi", "-i", f"sine=frequency=300:duration={duration:.0f}",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest", str(media),
        ],
        check=True,
    )

    caption_path = work / "captions.json3"
    caption_path.write_text(json.dumps(captions_json), encoding="utf-8")
    return {"media": media, "captions": caption_path, "duration": duration}


@pytest.fixture(autouse=True)
def stub_network(staged, monkeypatch):
    monkeypatch.setattr(
        ingest, "probe",
        lambda url: SourceVideo(
            video_id=VIDEO_ID, title="A Test Monologue", url=url,
            path=None, duration=staged["duration"], uploader="tester",
        ),
    )
    monkeypatch.setattr(ingest, "fetch_captions", lambda url, vid: staged["captions"])
    monkeypatch.setattr(
        ingest, "download_media", lambda url, vid, cb=None: staged["media"]
    )


def test_analyze_produces_ranked_clips():
    result = pipeline.analyze("https://example.com/watch?v=x", ranker="heuristic")

    assert result["transcript_source"] == "youtube-captions"
    assert result["ranker"] == "heuristic"
    assert result["word_count"] > 100
    assert result["candidates_considered"] > 20

    clips = result["clips"]
    assert clips, "expected at least one clip"

    for clip in clips:
        assert config.MIN_CLIP_SECONDS - 1 <= clip["duration"] <= config.MAX_CLIP_SECONDS + 1
        assert clip["start"] >= 0
        assert clip["end"] > clip["start"]
        assert clip["text"].strip()
        assert clip["title"].strip()
        assert 0 <= clip["score"] <= 100

    # Sorted best first.
    assert [c["score"] for c in clips] == sorted((c["score"] for c in clips), reverse=True)


def test_top_clip_lands_on_a_real_moment():
    """The scorer should surface the story beats, not the sign-off."""
    result = pipeline.analyze("https://example.com/watch?v=x", ranker="heuristic")
    top_text = result["clips"][0]["text"].lower()
    peaks = ("nobody tells you", "four hundred thousand", "biggest mistake", "eleven users")
    assert any(peak in top_text for peak in peaks), top_text
    assert "thanks for watching" not in top_text


def test_results_do_not_overlap_heavily():
    result = pipeline.analyze("https://example.com/watch?v=x", ranker="heuristic")
    clips = sorted(result["clips"], key=lambda c: c["start"])
    for a, b in zip(clips, clips[1:]):
        overlap = min(a["end"], b["end"]) - max(a["start"], b["start"])
        shorter = min(a["duration"], b["duration"])
        assert overlap <= 0 or overlap / shorter <= config.NMS_OVERLAP + 0.01


def test_analysis_is_cached_to_disk():
    pipeline.analyze("https://example.com/watch?v=x")
    cached = pipeline.load_analysis(VIDEO_ID)
    assert cached["source"]["video_id"] == VIDEO_ID
    assert cached["words"], "word timings must be persisted for caption rendering"


def test_render_from_analysis_writes_a_playable_clip(tmp_path: Path):
    from app import captions as captions_mod
    from app import render

    analysis = pipeline.analyze("https://example.com/watch?v=x")
    clip = analysis["clips"][0]

    out = pipeline.render_from_analysis(
        analysis=analysis,
        clip_id=clip["id"],
        options=render.RenderOptions(aspect="vertical", captions=True),
        style=captions_mod.CaptionStyle(font="DejaVu Sans"),
        out_dir=tmp_path / "render",
    )

    assert out.exists() and out.stat().st_size > 20_000
    assert render.probe_dimensions(out) == (1080, 1920)
    assert (tmp_path / "render" / "captions.ass").exists()

    probed = subprocess.run(
        [config.FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(out)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert abs(float(probed) - clip["duration"]) < 1.0


def test_render_unknown_clip_id_is_rejected(tmp_path: Path):
    from app import captions as captions_mod
    from app import render

    analysis = pipeline.analyze("https://example.com/watch?v=x")
    with pytest.raises(ValueError):
        pipeline.render_from_analysis(
            analysis=analysis,
            clip_id="nope",
            options=render.RenderOptions(),
            style=captions_mod.CaptionStyle(),
            out_dir=tmp_path,
        )


# --------------------------------------------------------------------------- #
# HTTP layer
# --------------------------------------------------------------------------- #

def _wait(client: TestClient, job_id: str, timeout: float = 240.0) -> dict:
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] == "done":
            return job["result"]
        if job["status"] == "error":
            pytest.fail(f"job failed: {job['error']}")
        time.sleep(0.4)
    pytest.fail("job timed out")


def test_http_analyze_then_render_roundtrip():
    from app.main import app

    with TestClient(app) as client:
        started = client.post(
            "/api/analyze", json={"url": "https://example.com/watch?v=x", "max_results": 5}
        )
        assert started.status_code == 200
        result = _wait(client, started.json()["id"])

        assert "words" not in result, "the browser payload must not carry the word list"
        assert 1 <= len(result["clips"]) <= 5
        clip_id = result["clips"][0]["id"]

        rendered = client.post(
            "/api/render",
            json={
                "video_id": VIDEO_ID,
                "clip_id": clip_id,
                "aspect": "vertical",
                "captions": {"enabled": True, "style": "pop", "accent": "#22E06B"},
            },
        )
        assert rendered.status_code == 200
        output = _wait(client, rendered.json()["id"])

        assert output["url"].startswith("/clips/")
        assert output["size_bytes"] > 10_000
        assert client.get(output["url"]).status_code == 200


def test_http_render_unknown_video_is_404():
    from app.main import app

    with TestClient(app) as client:
        response = client.post(
            "/api/render", json={"video_id": "missing", "clip_id": "c0000"}
        )
        assert response.status_code == 404


def test_http_analyze_rejects_blank_url():
    from app.main import app

    with TestClient(app) as client:
        assert client.post("/api/analyze", json={"url": "  "}).status_code == 400
