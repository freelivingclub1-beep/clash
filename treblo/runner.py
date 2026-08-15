"""The scheduler.

Keeps the queue as full as Treblo allows, forever:

  * fire a generation whenever there's a free slot
  * otherwise report exactly when the next slot is expected, from measured
    render times rather than a guessed cooldown
  * rotate the non-anchor tags on a cadence so the catalogue doesn't turn into
    one sound repeated
  * write fresh, non-repeating custom lyrics for most generations, and let
    Treblo's Auto Lyrics take every Nth one
  * record every song in the local index, audio excluded
"""

from __future__ import annotations

import itertools
import time
from dataclasses import dataclass, field
from typing import Callable

from .analysis import Analyzer, NullAnalyzer
from .driver import GenerationSpec, JobState, TrebloDriver
from .library import Library
from .lyrics import Deduplicator, LyricWriter, ThemeBank
from .quota import Quota
from .tags import ANCHOR_TAG, MAX_TAGS, TagSet


@dataclass
class RunnerConfig:
    bars_per_song: int = 16
    auto_lyrics_every: int = 3       # every Nth generation uses Treblo's Auto Lyrics
    swap_tags_every: int = 4         # generations between non-anchor tag rotations
    poll_interval_s: float = 15.0
    # Floor on polling, so an overdue job doesn't turn into a hammering loop.
    min_poll_interval_s: float = 5.0
    model: str = "v3"
    style_strength: float = 4.50


@dataclass
class Runner:
    driver: TrebloDriver
    library: Library
    writer: LyricWriter
    quota: Quota
    tag_set: TagSet
    rotation_pool: list[str] = field(default_factory=list)
    themes: ThemeBank = field(default_factory=ThemeBank)
    config: RunnerConfig = field(default_factory=RunnerConfig)
    analyzer: Analyzer = field(default_factory=NullAnalyzer)
    clock: Callable[[], float] = time.time

    generation_count: int = field(default=0, init=False)
    _jobs: dict[str, list[int]] = field(default_factory=dict, init=False)
    _rotation: "itertools.cycle | None" = field(default=None, init=False)
    _rotation_slot: int = field(default=0, init=False)

    def __post_init__(self) -> None:
        if self.rotation_pool:
            self._rotation = itertools.cycle(self.rotation_pool)

    # -- one step ---------------------------------------------------------

    def tick(self) -> dict:
        """Reconcile in-flight jobs, then start one if allowed."""
        finished = self._reap()
        started = None
        if self.quota.can_start():
            started = self._start_generation()
        analyzed = self.analyze_pending()
        return {
            "finished": finished,
            "started": started,
            "analyzed": analyzed,
            "quota": self.quota.status(),
        }

    def analyze_pending(self, limit: int = 4) -> list[int]:
        """Measure key/BPM for songs that have landed but aren't analysed.

        Runs after generation is dispatched, never before -- analysis is nice
        to have, and must not be what stops a free slot being used. A song
        whose analysis fails is logged and left alone rather than retried
        forever; the audio is deleted either way.
        """
        if isinstance(self.analyzer, NullAnalyzer):
            return []

        analyzed = []
        for song in self.library.songs_awaiting_analysis(limit=limit):
            try:
                features = self.analyzer.analyze(song.treblo_url)
            except Exception as exc:
                self.library.log(self.clock(), "analysis_failed", f"song {song.id}: {exc}")
                # Record an empty row so we don't retry this one every tick.
                from .analysis import AudioFeatures

                self.library.add_features(song.id, self.clock(), AudioFeatures())
                continue
            self.library.add_features(song.id, self.clock(), features)
            self.library.log(self.clock(), "analyzed", f"song {song.id}: {features.summary()}")
            analyzed.append(song.id)
        return analyzed

    def run(self, max_generations: int | None = None, sleep: Callable[[float], None] = time.sleep) -> None:
        """Keep going until the generation cap is hit, or forever if None."""
        while max_generations is None or self.generation_count < max_generations:
            result = self.tick()
            if result["started"] is None and not result["finished"]:
                sleep(self.wait_hint())

        # Don't leave the last batch un-recorded -- or un-analysed.
        while self.quota.in_flight:
            if not self._reap():
                sleep(self.wait_hint())
            self.analyze_pending()

        # The final reap can land songs after the loop above exits.
        self.analyze_pending()

    def wait_hint(self) -> float:
        """How long to sleep before the next poll.

        Bounded on both sides: never hammer the site when a job has overrun
        its estimate, never sleep so long that a freed slot sits idle.
        """
        return max(
            self.config.min_poll_interval_s,
            min(self.config.poll_interval_s, self.quota.seconds_until_available()),
        )

    # -- internals --------------------------------------------------------

    def _reap(self) -> list[str]:
        """Poll in-flight jobs; settle any that landed."""
        finished = []
        for job_id in list(self.quota.in_flight):
            status = self.driver.poll(job_id)
            if status.retry_after:
                self.quota.note_backoff(self.clock() + status.retry_after)

            if status.state is JobState.DONE:
                self.quota.record_complete(job_id)
                self._record_songs(job_id, status)
                finished.append(job_id)
            elif status.state is JobState.FAILED:
                self.quota.record_failure(job_id)
                for song_id in self._jobs.pop(job_id, []):
                    self.library.update_song(song_id, status="failed")
                self.library.log(self.clock(), "job_failed", f"{job_id}: {status.error}")
                finished.append(job_id)
        return finished

    def _record_songs(self, job_id: str, status) -> None:
        song_ids = self._jobs.pop(job_id, [])
        # Treblo returns two songs per generation; we pre-registered rows for
        # them at submit time, so pair them up and fill in the details.
        for song_id, rendered in zip(song_ids, status.songs):
            self.library.update_song(
                song_id,
                status="done",
                treblo_url=rendered.url,
                title=rendered.title,
            )
        # More songs came back than we expected -- record the extras too.
        for rendered in status.songs[len(song_ids):]:
            self.library.add_song(
                created_at=self.clock(),
                tags=self.tag_set.tags,
                lyric_mode="unknown",
                status="done",
                job_id=job_id,
                treblo_url=rendered.url,
                title=rendered.title,
            )
        self.library.log(self.clock(), "job_done", f"{job_id}: {len(status.songs)} songs")

    def _start_generation(self) -> dict:
        index = self.generation_count
        self._maybe_rotate_tags(index)

        use_auto = (index + 1) % self.config.auto_lyrics_every == 0
        theme = self.themes.for_index(index)
        tags = self.tag_set.tags

        lyrics = None
        rejections = 0
        short = False
        if not use_auto:
            result = self.writer.write(
                tags=tags, theme=theme, bars=self.config.bars_per_song, seed=index
            )
            rejections = len(result.rejections)
            short = result.short
            lyrics = "\n".join(result.lines)
            accepted_rows = self.writer.accepted_rows(result.lines)
        else:
            accepted_rows = []

        spec = GenerationSpec(
            tags=tags,
            lyric_mode="auto" if use_auto else "custom",
            lyrics=lyrics,
            model=self.config.model,
            style_strength=self.config.style_strength,
        )

        # Register the two songs before submitting, so a crash between submit
        # and the first poll still leaves a record pointing at the job.
        song_ids = [
            self.library.add_song(
                created_at=self.clock(),
                tags=tags,
                lyric_mode=spec.lyric_mode,
                theme=theme,
                status="queued",
            )
            for _ in range(self.quota.songs_per_generation)
        ]

        job_id = self.driver.submit(spec)
        self.quota.record_start(job_id)
        self._jobs[job_id] = song_ids
        for song_id in song_ids:
            self.library.update_song(song_id, job_id=job_id)

        if accepted_rows:
            # Commit the bars only once the generation is actually accepted,
            # so a failed submit doesn't burn them out of the corpus.
            self.library.add_lines(song_ids[0], accepted_rows)

        self.generation_count += 1
        self.library.log(
            self.clock(),
            "generation_started",
            f"{job_id} tags={','.join(tags)} lyrics={spec.lyric_mode}",
        )
        return {
            "job_id": job_id,
            "tags": tags,
            "lyric_mode": spec.lyric_mode,
            "theme": theme,
            "bars": 0 if use_auto else len(lyrics.splitlines()),
            "lyric_rejections": rejections,
            "short_of_target": short,
            "song_ids": song_ids,
        }

    def _maybe_rotate_tags(self, index: int) -> None:
        if not self._rotation or index == 0:
            return
        if index % self.config.swap_tags_every != 0:
            return

        swappable = self.tag_set.swappable
        if not swappable:
            return

        # Walk the non-anchor slots round-robin, so every slot eventually
        # turns over instead of the same one churning forever.
        outgoing = swappable[self._rotation_slot % len(swappable)]
        self._rotation_slot += 1

        for _ in range(len(self.rotation_pool)):
            incoming = next(self._rotation)
            if incoming in self.tag_set.tags:
                continue
            self.tag_set = self.tag_set.swap(outgoing, incoming)
            self.library.log(
                self.clock(), "tags_rotated", f"-{outgoing} +{incoming}"
            )
            return

    # -- reporting --------------------------------------------------------

    def status(self) -> dict:
        return {
            "generations": self.generation_count,
            "songs_recorded": self.library.song_count(),
            "bars_in_corpus": self.library.line_count(),
            "tags": self.tag_set.tags,
            "anchor": ANCHOR_TAG,
            "tag_slots_free": MAX_TAGS - len(self.tag_set.tags),
            **self.quota.status(),
        }
