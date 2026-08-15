import pytest

from treblo.quota import COLD_START_ESTIMATE_S, Quota


class Clock:
    def __init__(self, t=0.0):
        self.t = t

    def __call__(self):
        return self.t

    def advance(self, dt):
        self.t += dt


def test_three_generations_then_blocked():
    clock = Clock()
    q = Quota(clock=clock)
    for i in range(3):
        assert q.can_start()
        q.record_start(f"j{i}")
    assert not q.can_start()
    assert q.pending_songs == 6


def test_starting_a_fourth_generation_raises():
    clock = Clock()
    q = Quota(clock=clock)
    for i in range(3):
        q.record_start(f"j{i}")
    with pytest.raises(RuntimeError, match="no free slot"):
        q.record_start("j3")


def test_completion_frees_a_slot():
    clock = Clock()
    q = Quota(clock=clock)
    for i in range(3):
        q.record_start(f"j{i}")
    clock.advance(60)
    assert q.record_complete("j0") == 60
    assert q.can_start()


def test_estimate_starts_cold_then_learns_real_timings():
    clock = Clock()
    q = Quota(clock=clock)
    assert q.estimated_duration() == COLD_START_ESTIMATE_S

    q.record_start("a")
    clock.advance(50)
    q.record_complete("a")
    assert q.estimated_duration() == 50


def test_estimate_tracks_a_changing_backend():
    clock = Clock()
    q = Quota(clock=clock)
    for i in range(6):
        q.record_start(f"j{i}")
        clock.advance(40)
        q.record_complete(f"j{i}")
    fast = q.estimated_duration()

    for i in range(6, 12):
        q.record_start(f"j{i}")
        clock.advance(200)
        q.record_complete(f"j{i}")
    assert q.estimated_duration() > fast


def test_next_available_predicts_from_the_oldest_job():
    clock = Clock()
    q = Quota(clock=clock)
    # Teach it that generations take 100s.
    q.record_start("warm")
    clock.advance(100)
    q.record_complete("warm")

    q.record_start("a")
    clock.advance(30)
    q.record_start("b")
    q.record_start("c")

    # 'a' started 30s ago and takes ~100s, so ~70s to go.
    assert 60 <= q.seconds_until_available() <= 80


def test_available_now_when_a_slot_is_free():
    clock = Clock(t=500.0)
    q = Quota(clock=clock)
    q.record_start("a")
    assert q.seconds_until_available() == 0
    assert q.next_available_at() == 500.0


def test_overdue_job_never_reports_a_time_in_the_past():
    clock = Clock()
    q = Quota(clock=clock)
    q.record_start("warm")
    clock.advance(30)
    q.record_complete("warm")

    for name in ("a", "b", "c"):
        q.record_start(name)
    clock.advance(600)  # everything is way overdue
    assert q.next_available_at() > clock()


def test_explicit_backoff_is_honoured():
    clock = Clock()
    q = Quota(clock=clock)
    q.note_backoff(clock() + 120)
    assert not q.can_start()
    assert q.seconds_until_available() == 120
    clock.advance(120)
    assert q.can_start()


def test_failures_dont_pollute_the_timing_model():
    clock = Clock()
    q = Quota(clock=clock)
    q.record_start("a")
    clock.advance(9999)
    q.record_failure("a")
    assert q.samples == 0
    assert q.estimated_duration() == COLD_START_ESTIMATE_S
    assert q.can_start()
