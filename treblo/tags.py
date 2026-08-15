"""Tag vocabulary and validation.

Rules enforced here (they mirror what treblo.com does in the Sound box):

  * "yeat" is always tag #1 and can never be swapped out or removed.
  * A generation needs at least 3 tags and never more than 6.
  * Tags must match the vocabulary exactly. Near-misses get a
    "Didn't find a tag" error with suggestions instead of silently
    generating something wrong.

The vocabulary in VOCAB_SEED is what has been confirmed by hand in the app.
It is not authoritative -- Treblo's "View all tags" is. Keep a local copy in
tags.json (see load_vocabulary) and this module will use that instead.
"""

from __future__ import annotations

import difflib
import json
import re
from pathlib import Path

ANCHOR_TAG = "yeat"
MIN_TAGS = 3
MAX_TAGS = 6

# Confirmed present in the app. Extend via tags.json rather than editing here.
VOCAB_SEED = frozenset(
    {
        "yeat",
        "trap",
        "piano",
        "guitar",
        "bass",
        "drums",
        "percussion",
        "sampling",
        "cloud rap",
        "hip hop",
        "rap",
        "pop",
        "jazz",
        "rock",
        "classical",
        "2000s",
        "2010s",
        "good artist",
    }
)


class TagError(ValueError):
    """Raised when a tag list would be rejected by Treblo."""


class UnknownTag(TagError):
    def __init__(self, tag: str, suggestions: list[str]) -> None:
        self.tag = tag
        self.suggestions = suggestions
        message = f"Didn't find a tag: {tag!r}"
        if suggestions:
            message += " - did you mean " + ", ".join(repr(s) for s in suggestions) + "?"
        super().__init__(message)


def load_vocabulary(path: str | Path | None = None) -> frozenset[str]:
    """Load the tag vocabulary, preferring a local tags.json if present."""
    if path is None:
        path = Path(__file__).with_name("tags.json")
    path = Path(path)
    if not path.exists():
        return VOCAB_SEED
    raw = json.loads(path.read_text())
    tags = raw["tags"] if isinstance(raw, dict) else raw
    return frozenset(normalize(t) for t in tags) | {ANCHOR_TAG}


def normalize(tag: str) -> str:
    """Collapse whitespace and case. Does NOT fix typos -- that's the point."""
    return re.sub(r"\s+", " ", tag.strip().lower())


def resolve(tag: str, vocabulary: frozenset[str] | None = None) -> str:
    """Return the canonical tag, or raise UnknownTag with suggestions."""
    vocab = vocabulary if vocabulary is not None else load_vocabulary()
    candidate = normalize(tag)
    if candidate in vocab:
        return candidate
    suggestions = difflib.get_close_matches(candidate, sorted(vocab), n=3, cutoff=0.6)
    raise UnknownTag(tag, suggestions)


def validate(tags: list[str], vocabulary: frozenset[str] | None = None) -> list[str]:
    """Validate a full tag list and return it canonicalized.

    Raises TagError (or UnknownTag) describing the first problem found, in the
    same order Treblo would complain about them.
    """
    vocab = vocabulary if vocabulary is not None else load_vocabulary()
    resolved = [resolve(t, vocab) for t in tags]

    seen: set[str] = set()
    duplicates = [t for t in resolved if t in seen or seen.add(t)]
    if duplicates:
        raise TagError(f"Duplicate tag: {duplicates[0]!r}")

    if not resolved or resolved[0] != ANCHOR_TAG:
        raise TagError(f"{ANCHOR_TAG!r} must be the first tag")
    if len(resolved) < MIN_TAGS:
        raise TagError(f"Need at least {MIN_TAGS} tags, got {len(resolved)}")
    if len(resolved) > MAX_TAGS:
        raise TagError(f"No more than {MAX_TAGS} tags, got {len(resolved)}")
    return resolved


class TagSet:
    """A validated tag list where everything but the anchor can be swapped."""

    def __init__(self, tags: list[str], vocabulary: frozenset[str] | None = None) -> None:
        self._vocab = vocabulary if vocabulary is not None else load_vocabulary()
        self._tags = validate(tags, self._vocab)

    @property
    def tags(self) -> list[str]:
        return list(self._tags)

    @property
    def swappable(self) -> list[str]:
        """Everything after the anchor tag."""
        return list(self._tags[1:])

    def swap(self, old: str, new: str) -> "TagSet":
        """Replace one tag. Refuses to touch the anchor."""
        old_c = normalize(old)
        if old_c == ANCHOR_TAG:
            raise TagError(f"{ANCHOR_TAG!r} is locked and cannot be swapped out")
        if old_c not in self._tags:
            raise TagError(f"Not currently using tag: {old!r}")
        new_c = resolve(new, self._vocab)
        replaced = [new_c if t == old_c else t for t in self._tags]
        return TagSet(replaced, self._vocab)

    def add(self, tag: str) -> "TagSet":
        return TagSet(self._tags + [tag], self._vocab)

    def remove(self, tag: str) -> "TagSet":
        tag_c = normalize(tag)
        if tag_c == ANCHOR_TAG:
            raise TagError(f"{ANCHOR_TAG!r} is locked and cannot be removed")
        if tag_c not in self._tags:
            raise TagError(f"Not currently using tag: {tag!r}")
        return TagSet([t for t in self._tags if t != tag_c], self._vocab)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, TagSet) and other._tags == self._tags

    def __repr__(self) -> str:
        return f"TagSet({self._tags!r})"
