"""Treblo song generator / storer.

A scheduler that keeps a Treblo account generating continuously without
storing audio locally, respecting the burst limit, guaranteeing no repeated
bars across the whole catalogue, and rotating tags around a locked "yeat".
"""

from .driver import FakeDriver, GenerationSpec, JobState, JobStatus, TrebloDriver
from .library import Library, Song
from .lyrics import (
    Deduplicator,
    LyricWriter,
    TemplateSource,
    ThemeBank,
    TopicFilter,
)
from .quota import Quota
from .runner import Runner, RunnerConfig
from .tags import ANCHOR_TAG, MAX_TAGS, MIN_TAGS, TagError, TagSet, UnknownTag

__all__ = [
    "ANCHOR_TAG",
    "Deduplicator",
    "FakeDriver",
    "GenerationSpec",
    "JobState",
    "JobStatus",
    "Library",
    "LyricWriter",
    "MAX_TAGS",
    "MIN_TAGS",
    "Quota",
    "Runner",
    "RunnerConfig",
    "Song",
    "TagError",
    "TagSet",
    "TemplateSource",
    "ThemeBank",
    "TopicFilter",
    "TrebloDriver",
    "UnknownTag",
]
