"""Group words into sentence-like units, then enumerate candidate clips."""

from __future__ import annotations

import re

from . import config
from .models import Candidate, Transcript, Unit, Word

SENTENCE_END = re.compile(r"[.!?][\"')\]]*$")
# YouTube auto-captions carry no punctuation, so units are cut on pauses instead.
PAUSE_SPLIT = 0.55
LONG_UNIT_WORDS = 32


def _is_punctuated(words: list[Word]) -> bool:
    if len(words) < 40:
        return False
    enders = sum(1 for w in words if SENTENCE_END.search(w.text))
    return enders / len(words) > 0.02


def build_units(transcript: Transcript) -> list[Unit]:
    words = transcript.words
    if not words:
        return []

    punctuated = _is_punctuated(words)
    units: list[Unit] = []
    start_idx = 0

    for i, word in enumerate(words):
        gap_after = words[i + 1].start - word.end if i + 1 < len(words) else 999.0
        length = i - start_idx + 1

        if punctuated:
            should_break = bool(SENTENCE_END.search(word.text))
        else:
            should_break = gap_after >= PAUSE_SPLIT
        # Never let a unit run away — long units make clip boundaries coarse.
        should_break = should_break or length >= LONG_UNIT_WORDS or i == len(words) - 1

        if not should_break:
            continue

        chunk = words[start_idx : i + 1]
        gap_before = (
            chunk[0].start - words[start_idx - 1].end if start_idx > 0 else 3.0
        )
        units.append(
            Unit(
                text=" ".join(w.text for w in chunk).strip(),
                start=chunk[0].start,
                end=chunk[-1].end,
                first_word=start_idx,
                last_word=i,
                gap_before=max(0.0, gap_before),
                ends_sentence=bool(SENTENCE_END.search(word.text)) or gap_after >= PAUSE_SPLIT,
            )
        )
        start_idx = i + 1

    return [u for u in units if u.text]


def enumerate_candidates(units: list[Unit]) -> list[tuple[int, int]]:
    """Every (start_unit, end_unit) window whose duration is in range."""
    spans: list[tuple[int, int]] = []
    min_s, max_s = config.MIN_CLIP_SECONDS, config.MAX_CLIP_SECONDS

    for i in range(len(units)):
        for j in range(i, len(units)):
            duration = units[j].end - units[i].start
            if duration > max_s:
                break
            if duration < min_s:
                continue
            spans.append((i, j))
    return spans


def span_to_candidate(units: list[Unit], i: int, j: int, index: int) -> Candidate:
    start = max(0.0, units[i].start - config.LEAD_IN)
    end = units[j].end + config.LEAD_OUT
    text = " ".join(u.text for u in units[i : j + 1]).strip()
    return Candidate(id=f"c{index:04d}", start=start, end=end, text=text)


def suppress_overlaps(
    candidates: list[Candidate], max_results: int, overlap_limit: float | None = None
) -> list[Candidate]:
    """Greedy non-maximum suppression so results are distinct moments."""
    limit = config.NMS_OVERLAP if overlap_limit is None else overlap_limit
    ordered = sorted(candidates, key=lambda c: c.score, reverse=True)
    kept: list[Candidate] = []

    for cand in ordered:
        if len(kept) >= max_results:
            break
        clash = False
        for k in kept:
            overlap = min(cand.end, k.end) - max(cand.start, k.start)
            if overlap <= 0:
                continue
            shorter = min(cand.duration, k.duration) or 1.0
            if overlap / shorter > limit:
                clash = True
                break
        if not clash:
            kept.append(cand)

    return sorted(kept, key=lambda c: c.start)
