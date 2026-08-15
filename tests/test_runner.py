import pytest

from treblo.driver import FakeDriver
from treblo.library import Library
from treblo.lyrics import Deduplicator, LyricWriter, TemplateSource, normalize_line
from treblo.quota import Quota
from treblo.runner import Runner, RunnerConfig
from treblo.tags import TagSet


class Clock:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t

    def advance(self, dt):
        self.t += dt

    def sleep(self, dt):
        self.t += dt


@pytest.fixture
def rig(tmp_path):
    clock = Clock()
    library = Library(tmp_path / "t.db")
    driver = FakeDriver(clock, seed=7)
    quota = Quota(clock=clock)
    writer = LyricWriter(TemplateSource(), Deduplicator(library))
    runner = Runner(
        driver=driver,
        library=library,
        writer=writer,
        quota=quota,
        tag_set=TagSet(["yeat", "trap", "piano"]),
        rotation_pool=["guitar", "bass", "cloud rap", "sampling"],
        config=RunnerConfig(bars_per_song=8),
        clock=clock,
    )
    yield runner, clock, library, driver
    library.close()


def test_fires_three_then_waits(rig):
    runner, clock, _, _ = rig
    for _ in range(3):
        assert runner.tick()["started"] is not None
    result = runner.tick()
    assert result["started"] is None
    assert result["quota"]["in_flight"] == 3
    assert result["quota"]["pending_songs"] == 6


def test_slot_frees_up_once_a_generation_lands(rig):
    runner, clock, _, _ = rig
    for _ in range(3):
        runner.tick()
    assert runner.tick()["started"] is None

    clock.advance(400)  # long enough for everything to render
    result = runner.tick()
    assert result["finished"]
    assert result["started"] is not None


def test_every_third_generation_uses_auto_lyrics(rig):
    runner, clock, _, driver = rig
    runner.run(max_generations=9, sleep=clock.sleep)

    modes = [s.lyric_mode for s in driver.submitted]
    assert modes == ["custom", "custom", "auto"] * 3


def test_custom_lyrics_are_actually_attached(rig):
    runner, clock, _, driver = rig
    runner.run(max_generations=2, sleep=clock.sleep)

    spec = driver.submitted[0]
    assert spec.lyric_mode == "custom"
    assert len(spec.lyrics.splitlines()) == 8


def test_auto_generations_send_no_lyrics(rig):
    runner, clock, _, driver = rig
    runner.run(max_generations=3, sleep=clock.sleep)
    assert driver.submitted[2].lyrics is None


def test_no_bar_repeats_across_a_long_run(rig):
    runner, clock, library, driver = rig
    runner.run(max_generations=30, sleep=clock.sleep)

    rows = library.conn.execute("SELECT normalized FROM lines").fetchall()
    normalized = [r["normalized"] for r in rows]
    assert normalized, "no lyrics were recorded"
    assert len(normalized) == len(set(normalized)), "a bar was reused"


def test_tags_rotate_but_yeat_never_moves(rig):
    runner, clock, _, driver = rig
    runner.run(max_generations=13, sleep=clock.sleep)

    tag_lists = [s.tags for s in driver.submitted]
    assert all(t[0] == "yeat" for t in tag_lists), "yeat left the first slot"
    assert len({tuple(t) for t in tag_lists}) > 1, "tags never rotated"
    assert all(3 <= len(t) <= 6 for t in tag_lists)


def test_rotation_reaches_every_non_anchor_slot(rig):
    """Regression: rotation used to churn slot 1 forever and never touch slot 2."""
    runner, clock, _, driver = rig
    runner.run(max_generations=25, sleep=clock.sleep)

    slot1 = {t.tags[1] for t in driver.submitted}
    slot2 = {t.tags[2] for t in driver.submitted}
    assert len(slot1) > 1
    assert len(slot2) > 1, "the last tag slot never rotated"


def test_every_song_lands_in_the_library_with_a_url(rig):
    runner, clock, library, _ = rig
    runner.run(max_generations=6, sleep=clock.sleep)

    done = library.songs(status="done")
    assert len(done) == 12  # 6 generations x 2 songs
    assert all(s.treblo_url for s in done)
    assert all(s.tags[0] == "yeat" for s in done)


def test_no_audio_is_stored_locally(rig):
    runner, clock, library, _ = rig
    runner.run(max_generations=4, sleep=clock.sleep)

    columns = {
        r[1] for r in library.conn.execute("PRAGMA table_info(songs)").fetchall()
    }
    assert not columns & {"audio", "blob", "data", "mp3"}
    # Only the pointer is kept.
    assert "treblo_url" in columns


def test_failed_generations_are_marked_and_dont_stall_the_loop(tmp_path):
    clock = Clock()
    library = Library(tmp_path / "t.db")
    driver = FakeDriver(clock, seed=3, failure_rate=1.0)
    runner = Runner(
        driver=driver,
        library=library,
        writer=LyricWriter(TemplateSource(), Deduplicator(library)),
        quota=Quota(clock=clock),
        tag_set=TagSet(["yeat", "trap", "piano"]),
        config=RunnerConfig(bars_per_song=4),
        clock=clock,
    )
    runner.run(max_generations=4, sleep=clock.sleep)

    assert runner.generation_count == 4
    assert len(library.songs(status="failed")) == 8
    library.close()


def test_poll_interval_is_bounded_at_both_ends(rig):
    runner, clock, _, _ = rig
    cfg = runner.config
    for _ in range(3):
        runner.tick()

    # Nothing is overdue yet: wait is capped by poll_interval_s.
    assert runner.wait_hint() <= cfg.poll_interval_s

    # Everything overdue: still never polls faster than the floor.
    clock.advance(10_000)
    assert runner.wait_hint() >= cfg.min_poll_interval_s


def test_status_reports_when_the_next_generation_can_run(rig):
    runner, clock, _, _ = rig
    for _ in range(3):
        runner.tick()

    status = runner.status()
    assert status["in_flight"] == 3
    assert not status["can_start"]
    assert status["seconds_until_available"] > 0
    assert status["tags"][0] == "yeat"
