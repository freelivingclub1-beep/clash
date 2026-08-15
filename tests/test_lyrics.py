import pytest

from treblo.library import Library
from treblo.lyrics import (
    Deduplicator,
    LyricWriter,
    TemplateSource,
    TopicFilter,
    normalize_line,
    shingles,
)


@pytest.fixture
def library(tmp_path):
    lib = Library(tmp_path / "t.db")
    yield lib
    lib.close()


def test_normalize_strips_punctuation_and_case():
    assert normalize_line("Woke UP in the city, rain!!") == "woke up in the city rain"


def test_short_lines_become_one_shingle():
    assert shingles("cold out") == ["cold out"]


def test_exact_repeat_is_caught(library):
    dedup = Deduplicator(library)
    song = library.add_song(created_at=0, tags=["yeat"], lyric_mode="custom")
    library.add_lines(song, [dedup.accept("Woke up in the city, frost on the glass")])
    dedup.reset_session()

    verdict = dedup.check("Woke up in the city, frost on the glass")
    assert verdict is not None
    assert verdict.reason == "exact_duplicate"


def test_repeat_with_different_punctuation_is_caught(library):
    dedup = Deduplicator(library)
    song = library.add_song(created_at=0, tags=["yeat"], lyric_mode="custom")
    library.add_lines(song, [dedup.accept("Left the numbers on read, took the highway instead")])
    dedup.reset_session()

    verdict = dedup.check("left the numbers on read -- took the highway instead!")
    assert verdict is not None
    assert verdict.reason == "exact_duplicate"


def test_heavily_overlapping_line_is_caught(library):
    dedup = Deduplicator(library)
    song = library.add_song(created_at=0, tags=["yeat"], lyric_mode="custom")
    library.add_lines(
        song, [dedup.accept("Been counting five nights since I left the old road behind me")]
    )
    dedup.reset_session()

    verdict = dedup.check("Been counting five nights since I left the old road for good")
    assert verdict is not None
    assert verdict.reason == "too_similar"


def test_genuinely_different_line_passes(library):
    dedup = Deduplicator(library)
    song = library.add_song(created_at=0, tags=["yeat"], lyric_mode="custom")
    library.add_lines(song, [dedup.accept("Woke up in the city, frost on the glass")])
    dedup.reset_session()

    assert dedup.check("They was quiet when I closed the gate behind us") is None


def test_repeats_within_the_same_song_are_caught(library):
    dedup = Deduplicator(library)
    dedup.accept("Same keys, different city, I don't answer no more")
    verdict = dedup.check("Same keys, different city, I don't answer no more")
    assert verdict is not None
    assert verdict.detail == "same song"


def test_topic_filter_blocks_the_stuff_we_dont_want():
    tf = TopicFilter()
    assert tf.rejects("Talking tax evasion on the second verse") == "tax evasion"
    assert tf.rejects("Woke up in the city, frost on the glass") is None


def test_writer_produces_the_requested_number_of_bars(library):
    writer = LyricWriter(TemplateSource(), Deduplicator(library))
    result = writer.write(tags=["yeat", "trap", "piano"], theme="the city", bars=16, seed=1)
    assert len(result.lines) == 16
    assert not result.short


def test_song_1_and_song_33_share_no_bars(library):
    """The headline guarantee: 33 songs, zero repeated bars."""
    dedup = Deduplicator(library)
    writer = LyricWriter(TemplateSource(), dedup)

    all_normalized = []
    for i in range(33):
        result = writer.write(
            tags=["yeat", "trap", "piano"], theme=f"theme {i % 7}", bars=12, seed=i
        )
        song_id = library.add_song(created_at=float(i), tags=["yeat"], lyric_mode="custom")
        rows = writer.accepted_rows(result.lines)
        library.add_lines(song_id, rows)
        all_normalized.extend(normalize_line(line) for line in result.lines)

    assert len(all_normalized) == len(set(all_normalized)), "a bar was reused"
    assert library.line_count() == len(all_normalized)


def test_off_topic_bars_are_rejected_not_shipped(library):
    class BadSource:
        def __init__(self):
            self.calls = 0

        def draft(self, *, tags, theme, bars, seed):
            self.calls += 1
            if self.calls == 1:
                return ["Talking tax evasion in the booth"] * bars
            return TemplateSource().draft(tags=tags, theme=theme, bars=bars, seed=seed)

    writer = LyricWriter(BadSource(), Deduplicator(library))
    result = writer.write(tags=["yeat", "trap", "piano"], theme="x", bars=4, seed=0)

    assert all("tax evasion" not in line for line in result.lines)
    assert any(r.reason == "off_topic" for r in result.rejections)


def test_writer_reports_when_it_cannot_fill_the_verse(library):
    class OneNoteSource:
        def draft(self, *, tags, theme, bars, seed):
            return ["The exact same bar every single time you ask"] * bars

    writer = LyricWriter(OneNoteSource(), Deduplicator(library))
    result = writer.write(tags=["yeat", "trap", "piano"], theme="x", bars=8, seed=0)

    assert result.short
    assert len(result.lines) == 1  # the first one is fine, the rest are repeats
