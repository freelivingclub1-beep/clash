"""Lyric generation with a hard no-repeat guarantee.

Two separate jobs:

  1. `Deduplicator` -- the gate. Every candidate bar is checked against every
     bar ever accepted, so song 1 and song 33 cannot share a line. Comparison
     is on word 4-grams, not exact strings, so a reshuffled version of an old
     bar gets caught too.

  2. `LyricSource` -- the writer. Swappable. `TemplateSource` runs offline and
     builds bars combinatorially; `AnthropicSource` calls Claude. Neither is
     trusted to avoid repeats on its own -- both go through the gate.

Subject matter is steered by `ThemeBank` and screened by `TopicFilter`, which
rejects bars about the stuff you don't want on the account.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass, field
from typing import Protocol

SHINGLE_SIZE = 4
# Jaccard overlap at or above this counts as "same bar".
SIMILARITY_THRESHOLD = 0.4
MAX_ATTEMPTS_PER_LINE = 40

_PUNCT = re.compile(r"[^\w\s']")
_SPACE = re.compile(r"\s+")


def normalize_line(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    return _SPACE.sub(" ", _PUNCT.sub(" ", text.lower())).strip()


def shingles(normalized: str, size: int = SHINGLE_SIZE) -> list[str]:
    """Word n-grams. Short lines become a single whole-line shingle."""
    words = normalized.split()
    if not words:
        return []
    if len(words) < size:
        return [" ".join(words)]
    return [" ".join(words[i : i + size]) for i in range(len(words) - size + 1)]


# --------------------------------------------------------------------------
# Subject matter
# --------------------------------------------------------------------------

# Keep it to ordinary rap subject matter. These are screened out so nothing on
# the account is about crime-how-to, real named people, or anything that would
# get a track pulled.
DEFAULT_BANNED = (
    "tax evasion",
    "launder",
    "money laundering",
    "fraud",
    "wire fraud",
    "counterfeit",
    "traffick",
    "overdose",
    "suicide",
    "kill you",
    "shoot you",
    "shoot up",
    "school shoot",
    "bomb",
    "terror",
    "nazi",
)


@dataclass
class TopicFilter:
    banned: tuple[str, ...] = DEFAULT_BANNED

    def rejects(self, text: str) -> str | None:
        """Return the offending phrase, or None if the line is fine."""
        haystack = normalize_line(text)
        for phrase in self.banned:
            if phrase in haystack:
                return phrase
        return None


@dataclass
class ThemeBank:
    """Rotating subject matter, so consecutive songs aren't all the same."""

    themes: list[str] = field(
        default_factory=lambda: [
            "late night drives with nowhere to be",
            "coming up from nothing",
            "loyalty to the people who were there early",
            "the city after everyone else has gone home",
            "outgrowing the room you started in",
            "the cost of never slowing down",
            "who you were before the phone never stopped",
            "winter, empty streets, warm car",
            "keeping your circle small on purpose",
            "everything moving faster than you planned",
            "the quiet right after a long night",
            "old friends who took a different exit",
        ]
    )

    def for_index(self, index: int) -> str:
        return self.themes[index % len(self.themes)]


# --------------------------------------------------------------------------
# The no-repeat gate
# --------------------------------------------------------------------------


@dataclass
class Rejection:
    line: str
    reason: str
    detail: str | None = None


class Deduplicator:
    """Checks candidate bars against the whole accepted corpus."""

    def __init__(self, library, threshold: float = SIMILARITY_THRESHOLD) -> None:
        self.library = library
        self.threshold = threshold
        # Bars accepted during the current song, not yet written to the DB.
        self._session: list[tuple[str, set[str]]] = []

    def check(self, text: str) -> Rejection | None:
        normalized = normalize_line(text)
        if not normalized:
            return Rejection(text, "empty")

        if self.library.has_exact_line(normalized):
            return Rejection(text, "exact_duplicate")

        candidate = shingles(normalized)
        candidate_set = set(candidate)

        for prior_norm, prior_shingles in self._session:
            if prior_norm == normalized:
                return Rejection(text, "exact_duplicate", "same song")
            if self._jaccard(candidate_set, prior_shingles) >= self.threshold:
                return Rejection(text, "too_similar", "same song")

        shared_counts = self.library.lines_sharing_shingles(candidate)
        for line_id, shared in shared_counts.items():
            prior_size = self.library.shingle_count(line_id)
            union = len(candidate_set) + prior_size - shared
            if union > 0 and shared / union >= self.threshold:
                return Rejection(text, "too_similar", self.library.line_text(line_id))
        return None

    def accept(self, text: str) -> tuple[str, str, list[str]]:
        """Record a line as used and return the tuple Library.add_lines wants."""
        normalized = normalize_line(text)
        line_shingles = shingles(normalized)
        self._session.append((normalized, set(line_shingles)))
        return (text, normalized, line_shingles)

    def reset_session(self) -> None:
        self._session.clear()

    @staticmethod
    def _jaccard(a: set[str], b: set[str]) -> float:
        if not a or not b:
            return 0.0
        return len(a & b) / len(a | b)


# --------------------------------------------------------------------------
# Sources
# --------------------------------------------------------------------------


class LyricSource(Protocol):
    def draft(self, *, tags: list[str], theme: str, bars: int, seed: int) -> list[str]:
        """Return candidate bars. May be rejected by the gate; that's expected."""
        ...


# Slots are typed by grammar so the filler can't produce "I'll carried":
#   {past}  past tense      {base} bare infinitive     {third} third person
_OPENERS = [
    "Woke up in the {place}, {weather} on the glass",
    "Been counting {count} nights since I {past} the old road",
    "They was quiet when I {past} the {noun}",
    "Same {noun}, different {place}, I don't {base} no more",
    "Told 'em give me {count} months, I'll {base} the whole {noun}",
    "{place} at {count} in the morning, nothing but the {noun}",
    "I don't {base} for the room, the room {third} for me",
    "Left the {noun} on read, took the {place} instead",
]
_CLOSERS = [
    "still ain't {past} the same",
    "and the {noun} keep talking",
    "but the {place} stay cold",
    "I ain't looking back at it",
    "that's the part they never film",
    "and I'm good with the quiet now",
    "they don't ask where I been",
    "and the {noun} finally match the plan",
]
_BANKS = {
    "place": ["city", "east side", "parking lot", "highway", "old block", "airport",
              "hotel", "backseat", "studio", "overpass", "top floor", "side street"],
    "weather": ["rain", "frost", "fog", "heat", "snow", "grey light", "wind", "sun"],
    "count": ["two", "three", "five", "nine", "twelve", "forty", "a hundred", "six"],
    "past": ["left", "changed", "carried", "outran", "rebuilt", "flipped", "held",
             "closed", "opened", "traded", "burned", "answered"],
    "base": ["leave", "change", "carry", "outrun", "rebuild", "flip", "hold",
             "close", "open", "trade", "burn", "answer"],
    "third": ["waits", "moves", "listens", "turns", "opens", "settles", "clears"],
    "noun": ["numbers", "keys", "gate", "list", "door", "record", "line", "table",
             "clock", "map", "signal", "window", "engine", "ledger"],
}


class TemplateSource:
    """Offline generator. Big combinatorial space, seeded per song.

    Not a substitute for a real lyric model -- it exists so the scheduler,
    the gate, and the whole pipeline can be run and tested without network
    access or API spend.
    """

    def draft(self, *, tags: list[str], theme: str, bars: int, seed: int) -> list[str]:
        rng = random.Random((seed, theme, tuple(tags)).__hash__() & 0xFFFFFFFF)
        out = []
        for _ in range(bars):
            template = rng.choice(_OPENERS) + ", " + rng.choice(_CLOSERS)
            line = self._fill(template, rng)
            out.append(line[:1].upper() + line[1:])
        return out

    @staticmethod
    def _fill(template: str, rng: random.Random) -> str:
        def sub(match: re.Match) -> str:
            return rng.choice(_BANKS[match.group(1)])

        return re.sub(r"\{(\w+)\}", sub, template)


LYRIC_SYSTEM_PROMPT = """You write rap verses in the style of the tags you are given.

Hard rules:
- Every bar must be original. You will be told which bars are already taken;
  never reuse or lightly reword any of them.
- Keep the subject matter to ordinary rap territory: ambition, the city, late
  nights, loyalty, money as a scoreboard, memory, pressure, distance.
- Do not write about committing crimes, drugs as instruction, real named
  people, self-harm, or anything a distributor would pull.
- Return only the bars, one per line. No headings, no numbering, no commentary.
"""


class AnthropicSource:
    """Claude-backed lyric writer.

    Requires the `anthropic` package and credentials in the environment
    (ANTHROPIC_API_KEY, or a profile from `ant auth login`).
    """

    def __init__(self, model: str = "claude-opus-5", client=None) -> None:
        self.model = model
        self._client = client

    def _get_client(self):
        if self._client is None:
            import anthropic

            self._client = anthropic.Anthropic()
        return self._client

    def draft(
        self,
        *,
        tags: list[str],
        theme: str,
        bars: int,
        seed: int,
        avoid: list[str] | None = None,
    ) -> list[str]:
        avoid_block = ""
        if avoid:
            joined = "\n".join(f"- {line}" for line in avoid[:60])
            avoid_block = f"\n\nBars already used elsewhere, do not reuse:\n{joined}"

        prompt = (
            f"Style tags: {', '.join(tags)}\n"
            f"Subject: {theme}\n"
            f"Write {bars} original bars. Variation set {seed}."
            f"{avoid_block}"
        )

        response = self._get_client().messages.create(
            model=self.model,
            max_tokens=2000,
            system=LYRIC_SYSTEM_PROMPT,
            thinking={"type": "adaptive"},
            messages=[{"role": "user", "content": prompt}],
        )
        if response.stop_reason == "refusal":
            return []
        text = "".join(b.text for b in response.content if b.type == "text")
        return [line.strip() for line in text.splitlines() if line.strip()]


# --------------------------------------------------------------------------
# Writer
# --------------------------------------------------------------------------


@dataclass
class LyricResult:
    lines: list[str]
    rejections: list[Rejection]
    short: bool = False


class LyricWriter:
    """Drives a source through the gate until it has enough clean bars."""

    def __init__(
        self,
        source: LyricSource,
        deduplicator: Deduplicator,
        topic_filter: TopicFilter | None = None,
    ) -> None:
        self.source = source
        self.dedup = deduplicator
        self.topics = topic_filter or TopicFilter()

    def write(self, *, tags: list[str], theme: str, bars: int, seed: int) -> LyricResult:
        self.dedup.reset_session()
        accepted: list[str] = []
        rejections: list[Rejection] = []
        attempts = 0

        while len(accepted) < bars and attempts < MAX_ATTEMPTS_PER_LINE * bars:
            wanted = bars - len(accepted)
            batch = self.source.draft(
                tags=tags, theme=theme, bars=wanted, seed=seed + attempts
            )
            if not batch:
                break
            for candidate in batch:
                attempts += 1
                if len(accepted) >= bars:
                    break
                banned = self.topics.rejects(candidate)
                if banned:
                    rejections.append(Rejection(candidate, "off_topic", banned))
                    continue
                verdict = self.dedup.check(candidate)
                if verdict is not None:
                    rejections.append(verdict)
                    continue
                self.dedup.accept(candidate)
                accepted.append(candidate)

        return LyricResult(accepted, rejections, short=len(accepted) < bars)

    def accepted_rows(self, lines: list[str]) -> list[tuple[str, str, list[str]]]:
        return [(t, normalize_line(t), shingles(normalize_line(t))) for t in lines]
