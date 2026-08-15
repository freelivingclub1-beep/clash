"""Adaptive generation quota.

Treblo lets you fire a small burst of generations and then makes you wait for
the earlier ones to finish rendering. The wait is *not* a fixed cooldown -- it
depends on load, so anything hard-coded is either too slow (wasted throughput)
or too fast (rejected requests).

This tracks the real thing instead: how many jobs are in flight, and how long
completions have actually been taking. `next_available_at` is a prediction that
gets better the longer the scheduler runs; it is never used as permission to
skip the concurrency check.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

DEFAULT_BURST = 3
DEFAULT_SONGS_PER_GENERATION = 2
# Used only before any completion has been observed.
COLD_START_ESTIMATE_S = 90.0
# Weight for the newest sample in the moving average of completion times.
EWMA_ALPHA = 0.3


@dataclass
class InFlight:
    job_id: str
    started_at: float


@dataclass
class Quota:
    """Concurrency gate plus a self-calibrating estimate of the next free slot."""

    burst: int = DEFAULT_BURST
    songs_per_generation: int = DEFAULT_SONGS_PER_GENERATION
    clock: Callable[[], float] = field(default=lambda: 0.0)

    _in_flight: dict[str, InFlight] = field(default_factory=dict, init=False)
    _durations: list[float] = field(default_factory=list, init=False)
    _ewma: float | None = field(default=None, init=False)
    _blocked_until: float = field(default=0.0, init=False)

    # -- observation ------------------------------------------------------

    def record_start(self, job_id: str) -> None:
        if job_id in self._in_flight:
            raise ValueError(f"job {job_id!r} already in flight")
        if not self.has_free_slot():
            raise RuntimeError(
                f"no free slot: {len(self._in_flight)}/{self.burst} generations in flight"
            )
        self._in_flight[job_id] = InFlight(job_id, self.clock())

    def record_complete(self, job_id: str) -> float:
        """Mark a job finished and fold its duration into the estimate."""
        job = self._in_flight.pop(job_id, None)
        if job is None:
            raise ValueError(f"job {job_id!r} is not in flight")
        duration = max(0.0, self.clock() - job.started_at)
        self._durations.append(duration)
        self._ewma = duration if self._ewma is None else (
            EWMA_ALPHA * duration + (1 - EWMA_ALPHA) * self._ewma
        )
        return duration

    def record_failure(self, job_id: str) -> None:
        """Drop a job without polluting the timing model with its duration."""
        self._in_flight.pop(job_id, None)

    def note_backoff(self, until: float) -> None:
        """Honour an explicit 'try again later' from the server."""
        self._blocked_until = max(self._blocked_until, until)

    # -- decisions --------------------------------------------------------

    def has_free_slot(self) -> bool:
        return len(self._in_flight) < self.burst

    def can_start(self) -> bool:
        return self.has_free_slot() and self.clock() >= self._blocked_until

    def next_available_at(self) -> float:
        """Best estimate of the next moment a generation could start.

        With a free slot this is now (or the end of an explicit backoff).
        Otherwise it is when the *oldest* in-flight job is expected to land.
        """
        now = self.clock()
        if self.has_free_slot():
            return max(now, self._blocked_until)

        oldest = min(self._in_flight.values(), key=lambda j: j.started_at)
        estimate = oldest.started_at + self.estimated_duration()
        # A job that has already overrun the estimate is due imminently, not
        # in the past -- don't report a time that has already gone by.
        return max(estimate, now + 1.0, self._blocked_until)

    def seconds_until_available(self) -> float:
        return max(0.0, self.next_available_at() - self.clock())

    def estimated_duration(self) -> float:
        """Expected seconds for one generation to finish rendering.

        Blends the moving average with observed spread so a jittery backend
        widens the estimate instead of causing a tight poll loop.
        """
        if self._ewma is None:
            return COLD_START_ESTIMATE_S
        if len(self._durations) < 2:
            return self._ewma
        mean = sum(self._durations) / len(self._durations)
        variance = sum((d - mean) ** 2 for d in self._durations) / len(self._durations)
        return self._ewma + math.sqrt(variance)

    # -- reporting --------------------------------------------------------

    @property
    def in_flight(self) -> list[str]:
        return [j.job_id for j in sorted(self._in_flight.values(), key=lambda j: j.started_at)]

    @property
    def pending_songs(self) -> int:
        return len(self._in_flight) * self.songs_per_generation

    @property
    def samples(self) -> int:
        return len(self._durations)

    def status(self) -> dict:
        return {
            "in_flight": len(self._in_flight),
            "burst": self.burst,
            "pending_songs": self.pending_songs,
            "can_start": self.can_start(),
            "seconds_until_available": round(self.seconds_until_available(), 1),
            "estimated_duration_s": round(self.estimated_duration(), 1),
            "timing_samples": self.samples,
        }
