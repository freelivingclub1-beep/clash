import pytest

from treblo.analysis import (
    AudioFeatures,
    LibrosaAnalyzer,
    NullAnalyzer,
    describe_brightness,
    detect_key,
)
from treblo.library import Library

# A pitch-class histogram is 12 bins, C through B.
C_MAJOR_SCALE = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1]


def chroma(strong: dict[int, float], base: float = 0.4) -> list[float]:
    """Build a 12-bin histogram with the given bins emphasised."""
    out = [base] * 12
    for index, value in strong.items():
        out[index] = value
    return out


def test_detects_c_major_from_a_c_major_scale():
    key, mode, _ = detect_key([float(v) for v in C_MAJOR_SCALE])
    assert (key, mode) == ("C", "major")


def test_detects_a_minor_when_the_minor_triad_dominates():
    # A(9) C(0) E(4) emphasised, with the leading tone G#(8) present.
    key, mode, _ = detect_key(chroma({9: 6.0, 0: 4.0, 4: 4.5, 8: 1.8}))
    assert (key, mode) == ("A", "minor")


def test_detects_f_sharp_as_a_tonic():
    key, _, _ = detect_key(chroma({6: 6.5, 10: 4.0, 1: 4.5}))
    assert key == "F#"


def test_key_detection_is_transposition_equivariant():
    """Rotating the histogram by N semitones must rotate the answer by N."""
    base = chroma({0: 6.0, 4: 4.5, 7: 4.0})
    root, mode, _ = detect_key(base)
    assert (root, mode) == ("C", "major")

    for shift in range(1, 12):
        rotated = base[-shift:] + base[:-shift]
        key, shifted_mode, _ = detect_key(rotated)
        assert shifted_mode == mode
        assert key == ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][shift]


def test_ambiguous_material_reports_low_confidence():
    flat = [1.0] * 12
    _, _, confidence = detect_key(flat)
    assert confidence < 0.1


def test_clear_material_reports_higher_confidence_than_ambiguous():
    _, _, clear = detect_key([float(v) for v in C_MAJOR_SCALE])
    _, _, murky = detect_key([1.0] * 12)
    assert clear > murky


def test_rejects_wrong_sized_input():
    with pytest.raises(ValueError, match="12 bins"):
        detect_key([1.0] * 7)


def test_brightness_descriptions_move_in_the_right_direction():
    assert describe_brightness(800) == "dark"
    assert describe_brightness(1800) == "warm"
    assert describe_brightness(3000) == "bright"
    assert describe_brightness(5000) == "harsh"


def test_summary_reads_like_something_you_can_act_on():
    features = AudioFeatures(bpm=142.3, key="F#", mode="minor", duration_s=131.4, brightness=900)
    assert features.summary() == "F# minor  142 BPM  2:11  dark"


def test_unanalysed_song_says_so_rather_than_pretending():
    assert AudioFeatures().summary() == "not analysed"
    assert AudioFeatures().key_name is None


def test_null_analyzer_returns_empty_features():
    assert NullAnalyzer().analyze("https://example/x.mp3") == AudioFeatures()


def test_audio_is_deleted_even_when_analysis_fails(tmp_path, monkeypatch):
    """The whole point is not keeping audio around. Failure mustn't leak files."""
    leaked = tmp_path / "leaked.audio"
    leaked.write_bytes(b"fake audio")

    analyzer = LibrosaAnalyzer()
    monkeypatch.setattr(analyzer, "_download", lambda url: str(leaked))
    monkeypatch.setattr(
        analyzer, "_measure", lambda path: (_ for _ in ()).throw(RuntimeError("boom"))
    )

    with pytest.raises(RuntimeError, match="boom"):
        analyzer.analyze("https://example/x.mp3")
    assert not leaked.exists(), "audio file survived a failed analysis"


def test_audio_is_deleted_after_a_successful_analysis(tmp_path, monkeypatch):
    temp = tmp_path / "ok.audio"
    temp.write_bytes(b"fake audio")

    analyzer = LibrosaAnalyzer()
    monkeypatch.setattr(analyzer, "_download", lambda url: str(temp))
    monkeypatch.setattr(analyzer, "_measure", lambda path: AudioFeatures(bpm=140.0))

    assert analyzer.analyze("https://example/x.mp3").bpm == 140.0
    assert not temp.exists()


# -- storage ---------------------------------------------------------------


@pytest.fixture
def library(tmp_path):
    lib = Library(tmp_path / "t.db")
    yield lib
    lib.close()


def test_features_round_trip(library):
    song_id = library.add_song(created_at=0, tags=["yeat"], lyric_mode="custom")
    features = AudioFeatures(
        bpm=142.0, key="F#", mode="minor", key_confidence=0.3,
        duration_s=131.4, loudness_db=-8.2, brightness=1900.0, energy=0.7,
    )
    library.add_features(song_id, 1.0, features)

    assert library.get_features(song_id) == features


def test_only_finished_songs_with_a_url_await_analysis(library):
    queued = library.add_song(created_at=0, tags=["yeat"], lyric_mode="custom")
    no_url = library.add_song(created_at=1, tags=["yeat"], lyric_mode="custom", status="done")
    ready = library.add_song(
        created_at=2, tags=["yeat"], lyric_mode="custom",
        status="done", treblo_url="https://cdn/x.mp3",
    )

    pending = [s.id for s in library.songs_awaiting_analysis()]
    assert pending == [ready]
    assert queued not in pending and no_url not in pending


def test_analysed_songs_drop_out_of_the_pending_list(library):
    song_id = library.add_song(
        created_at=0, tags=["yeat"], lyric_mode="custom",
        status="done", treblo_url="https://cdn/x.mp3",
    )
    assert library.songs_awaiting_analysis()

    library.add_features(song_id, 1.0, AudioFeatures(bpm=140.0))
    assert not library.songs_awaiting_analysis()


def test_find_by_key_and_bpm_range(library):
    def add(key, mode, bpm):
        sid = library.add_song(
            created_at=bpm, tags=["yeat"], lyric_mode="custom",
            status="done", treblo_url=f"https://cdn/{bpm}.mp3",
        )
        library.add_features(sid, 1.0, AudioFeatures(bpm=bpm, key=key, mode=mode))
        return sid

    slow = add("F#", "minor", 90.0)
    mid = add("F#", "minor", 140.0)
    fast = add("C", "major", 175.0)

    found = [s.id for s, _ in library.find_songs(key="F#")]
    assert set(found) == {slow, mid}

    found = [s.id for s, _ in library.find_songs(bpm_min=120, bpm_max=160)]
    assert found == [mid]

    found = [s.id for s, _ in library.find_songs(mode="major")]
    assert found == [fast]


def test_find_returns_results_ordered_by_bpm(library):
    for bpm in (170.0, 90.0, 130.0):
        sid = library.add_song(
            created_at=bpm, tags=["yeat"], lyric_mode="custom",
            status="done", treblo_url="https://cdn/x.mp3",
        )
        library.add_features(sid, 1.0, AudioFeatures(bpm=bpm, key="C", mode="major"))

    assert [f.bpm for _, f in library.find_songs()] == [90.0, 130.0, 170.0]
