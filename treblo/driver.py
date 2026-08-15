"""How the scheduler actually talks to Treblo.

Everything else in this package is backend-agnostic on purpose. Treblo has no
documented public API, so this is the one seam that has to be filled in
against the real site -- and the one place to change if the site changes.

Two implementations ship here:

  * FakeDriver    -- deterministic simulator. Runs the whole pipeline offline,
                     with variable render times so the quota estimator has
                     something realistic to learn from. Used by the tests.
  * BrowserDriver -- skeleton for driving treblo.com with Playwright. The
                     selectors are marked TODO because they must be read off
                     the live page, not guessed.
"""

from __future__ import annotations

import json
import random
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class JobState(str, Enum):
    QUEUED = "queued"
    RENDERING = "rendering"
    DONE = "done"
    FAILED = "failed"


@dataclass
class GenerationSpec:
    """One press of the Generate button."""

    tags: list[str]
    lyric_mode: str  # "custom" | "auto" | "none"
    lyrics: str | None = None
    model: str = "v3"
    style_strength: float = 4.50


@dataclass
class RenderedSong:
    external_id: str
    title: str | None = None
    url: str | None = None


@dataclass
class JobStatus:
    job_id: str
    state: JobState
    songs: list[RenderedSong] = field(default_factory=list)
    error: str | None = None
    retry_after: float | None = None  # seconds, when the backend asks us to wait


class TrebloDriver(ABC):
    """Minimal surface the scheduler needs."""

    @abstractmethod
    def submit(self, spec: GenerationSpec) -> str:
        """Start one generation. Returns a job id."""

    @abstractmethod
    def poll(self, job_id: str) -> JobStatus:
        """Check on a job. Must be cheap enough to call on a short interval."""


class FakeDriver(TrebloDriver):
    """Offline simulator with variable, seeded render times."""

    def __init__(
        self,
        clock,
        *,
        seed: int = 0,
        songs_per_generation: int = 2,
        min_render_s: float = 45.0,
        max_render_s: float = 180.0,
        failure_rate: float = 0.0,
    ) -> None:
        self.clock = clock
        self.rng = random.Random(seed)
        self.songs_per_generation = songs_per_generation
        self.min_render_s = min_render_s
        self.max_render_s = max_render_s
        self.failure_rate = failure_rate
        self._jobs: dict[str, dict] = {}
        self._counter = 0
        self.submitted: list[GenerationSpec] = []

    def submit(self, spec: GenerationSpec) -> str:
        self._counter += 1
        job_id = f"fake-{self._counter}"
        self._jobs[job_id] = {
            "spec": spec,
            "started": self.clock(),
            "duration": self.rng.uniform(self.min_render_s, self.max_render_s),
            "fails": self.rng.random() < self.failure_rate,
        }
        self.submitted.append(spec)
        return job_id

    def poll(self, job_id: str) -> JobStatus:
        job = self._jobs.get(job_id)
        if job is None:
            return JobStatus(job_id, JobState.FAILED, error="unknown job")
        elapsed = self.clock() - job["started"]
        if elapsed < job["duration"]:
            state = JobState.QUEUED if elapsed < job["duration"] / 4 else JobState.RENDERING
            return JobStatus(job_id, state)
        if job["fails"]:
            return JobStatus(job_id, JobState.FAILED, error="simulated render failure")
        songs = [
            RenderedSong(
                external_id=f"{job_id}-{i}",
                title=f"Untitled {job_id}-{i}",
                url=f"https://treblo.com/song/{job_id}-{i}",
            )
            for i in range(self.songs_per_generation)
        ]
        return JobStatus(job_id, JobState.DONE, songs=songs)


REQUIRED_SELECTORS = (
    "advanced_tab",
    "tag_input",
    "custom_lyrics_radio",
    "auto_lyrics_radio",
    "lyrics_textarea",
    "generate_button",
)

SELECTORS_PATH = Path(__file__).with_name("selectors.json")


def load_selectors(path: Path | None = None) -> dict[str, str]:
    """Load selectors discovered by scripts/discover_selectors.py."""
    path = path or SELECTORS_PATH
    if not path.exists():
        return {}
    return json.loads(path.read_text())


class BrowserDriver(TrebloDriver):
    """Drives the real site through a logged-in Playwright page.

    The UI flow, from the app:

      1. Advanced tab, Model = v3
      2. Sound: type each tag into "Search for styles" and pick the match
      3. Lyrics: Custom Lyrics + paste, or Auto Lyrics
      4. Style Strength slider
      5. Generate
      6. Watch the Library for the two new songs to finish rendering

    Selectors are not hardcoded here because guessing them produces code that
    fails on contact. Get them with:

        python -m treblo.session login
        python scripts/discover_selectors.py

    which writes treblo/selectors.json. This class refuses to construct until
    that file covers everything in REQUIRED_SELECTORS, so there's no way to
    half-wire it and get confusing failures later.
    """

    def __init__(
        self,
        page,
        base_url: str = "https://treblo.com",
        selectors: dict[str, str] | None = None,
    ) -> None:
        self.page = page
        self.base_url = base_url
        self.selectors = selectors if selectors is not None else load_selectors()
        self._check_configured()

    def _check_configured(self) -> None:
        missing = [k for k in REQUIRED_SELECTORS if not self.selectors.get(k)]
        if missing:
            raise NotImplementedError(
                "BrowserDriver needs real selectors before it can run. Missing: "
                + ", ".join(missing)
                + ".\nRun:  python -m treblo.session login"
                + "\n then: python scripts/discover_selectors.py"
            )

    def submit(self, spec: GenerationSpec) -> str:  # pragma: no cover - needs a browser
        raise NotImplementedError(
            "submit() still needs writing against the live page. The selectors "
            "are loaded; what's left is the click order and how Treblo reports "
            "a queued generation back."
        )

    def poll(self, job_id: str) -> JobStatus:  # pragma: no cover - needs a browser
        raise NotImplementedError(
            "poll() still needs writing: read the Library rows for this "
            "generation and map their render state onto JobState."
        )
