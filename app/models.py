"""Shared data types passed between the pipeline stages."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class Word:
    """One spoken word with its timing, in seconds from the start of the video."""

    text: str
    start: float
    end: float

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass
class Unit:
    """A sentence-ish chunk of speech — the atom candidate clips are built from."""

    text: str
    start: float
    end: float
    first_word: int
    last_word: int
    # Silence before this unit begins. A long gap is a clean place to cut in.
    gap_before: float = 0.0
    ends_sentence: bool = False

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass
class Candidate:
    """A proposed clip."""

    id: str
    start: float
    end: float
    text: str
    score: float = 0.0
    title: str = ""
    reason: str = ""
    features: dict[str, float] = field(default_factory=dict)
    ranked_by: str = "heuristic"

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["duration"] = round(self.duration, 2)
        d["start"] = round(self.start, 2)
        d["end"] = round(self.end, 2)
        d["score"] = round(self.score, 1)
        d["features"] = {k: round(v, 3) for k, v in self.features.items()}
        return d


@dataclass
class Transcript:
    words: list[Word]
    source: str  # "youtube-captions" | "whisper"
    language: str = "en"

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)

    @property
    def duration(self) -> float:
        return self.words[-1].end if self.words else 0.0


@dataclass
class SourceVideo:
    video_id: str
    title: str
    url: str
    path: str | None  # local media file, None until downloaded
    duration: float
    uploader: str = ""
    thumbnail: str = ""
