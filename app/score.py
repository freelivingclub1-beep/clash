"""Offline heuristic scorer — no API key, no credits.

The model of a clip that travels: it opens on something that creates a question
in the viewer's head, it stays dense, it resolves, and it can be understood
without the surrounding hour of video. Each of those is a separate feature so
the weights stay legible and tunable.
"""

from __future__ import annotations

import re

from .models import Candidate, Unit

WORD_RE = re.compile(r"[a-z']+")

# Openers that create a question the viewer wants answered.
HOOK_PHRASES = (
    "here's the thing", "here is the thing", "the truth is", "the reason",
    "what most people", "most people don't", "most people dont", "nobody talks about",
    "no one talks about", "nobody tells you", "the biggest mistake", "the problem is",
    "let me tell you", "i'll be honest", "ill be honest", "the crazy part",
    "the wild thing", "what happened was", "this changed everything",
    "i used to think", "i was wrong", "everyone thinks", "the secret",
    "here's why", "heres why", "the number one", "you need to understand",
    "i'll never forget", "ill never forget", "it turns out", "believe it or not",
)
HOOK_OPENERS = (
    "why", "how", "what", "when", "imagine", "picture", "listen", "look",
    "okay", "so", "here", "there's", "theres", "if", "the", "you", "most",
    "nobody", "everyone", "people", "honestly", "actually",
)
# Words that mark stakes, emotion or conflict.
INTENSITY = {
    "insane", "crazy", "wild", "shocking", "brutal", "terrifying", "horrible",
    "amazing", "incredible", "unbelievable", "ridiculous", "massive", "huge",
    "devastating", "dangerous", "illegal", "scandal", "lawsuit", "fired",
    "died", "death", "kill", "killed", "war", "fight", "fought", "attacked",
    "destroyed", "collapse", "crashed", "bankrupt", "million", "billion",
    "secret", "hidden", "banned", "exposed", "lied", "lying", "fraud",
    "never", "always", "everyone", "nobody", "worst", "best", "first", "only",
    "hate", "love", "scared", "afraid", "angry", "furious", "shocked",
    "changed", "transform", "regret", "mistake", "failed", "failure", "won",
    "proof", "evidence", "truth", "actually", "literally", "genuinely",
}
# Signals the speaker is telling a story rather than listing facts.
NARRATIVE = {
    "i", "me", "my", "we", "he", "she", "they", "then", "suddenly", "so",
    "because", "until", "finally", "remember", "happened", "realized",
}
# A clip that opens on one of these is answering something you did not hear.
DANGLING_OPENERS = {
    "but", "and", "so", "because", "which", "however", "although", "though",
    "that", "this", "these", "those", "it", "he", "she", "they", "them",
    "also", "anyway", "again", "plus", "yeah", "right", "okay", "well",
}
FILLER = {"um", "uh", "erm", "like", "you", "know", "kinda", "sorta", "basically"}


def _tokens(text: str) -> list[str]:
    return WORD_RE.findall(text.lower())


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def _hook_score(text: str) -> float:
    lowered = text.lower()
    opening = " ".join(_tokens(lowered)[:14])
    score = 0.0

    for phrase in HOOK_PHRASES:
        if phrase in opening:
            score += 0.55
            break
    first = opening.split(" ")[0] if opening else ""
    if first in HOOK_OPENERS:
        score += 0.2
    if "?" in text[: len(text) // 3 + 40]:
        score += 0.25
    # A concrete number in the opening is a strong specificity signal.
    if re.search(r"\b\d[\d,.]*\b|\b(one|two|three|five|ten|hundred|thousand|million|billion)\b", opening):
        score += 0.2
    if any(word in opening for word in ("never", "nobody", "everyone", "always", "only", "worst", "best")):
        score += 0.15
    return _clamp(score)


def _intensity_score(tokens: list[str]) -> float:
    if not tokens:
        return 0.0
    hits = sum(1 for t in tokens if t in INTENSITY)
    # ~6 charged words per 100 is a lively clip; more than that saturates.
    return _clamp((hits / len(tokens)) / 0.06)


def _narrative_score(tokens: list[str]) -> float:
    if not tokens:
        return 0.0
    hits = sum(1 for t in tokens if t in NARRATIVE)
    return _clamp((hits / len(tokens)) / 0.18)


def _density_score(tokens: list[str], duration: float) -> float:
    if duration <= 0:
        return 0.0
    wps = len(tokens) / duration
    # Conversational speech is ~2.3-3.3 words/sec. Below that is dead air.
    if wps < 1.4:
        return _clamp(wps / 1.4) * 0.4
    if wps > 4.4:
        return 0.7
    return _clamp((wps - 1.4) / 1.4)


def _filler_penalty(tokens: list[str]) -> float:
    if not tokens:
        return 0.0
    hits = sum(1 for t in tokens if t in FILLER)
    return _clamp((hits / len(tokens)) / 0.12)


def _standalone_score(units: list[Unit], i: int, j: int) -> float:
    """How well the clip survives being pulled out of the video."""
    score = 0.5
    opening = _tokens(units[i].text)
    if opening and opening[0] in DANGLING_OPENERS:
        score -= 0.3
    # A pause before the first word means we are cutting into silence, not speech.
    score += _clamp(units[i].gap_before / 0.8) * 0.3
    if units[j].ends_sentence:
        score += 0.2
    return _clamp(score)


def _duration_score(duration: float) -> float:
    """Short-form platforms reward 20-70s; longer clips need a stronger payoff."""
    if duration < 20:
        return 0.65
    if duration <= 70:
        return 1.0
    if duration <= 120:
        return 0.8
    return 0.62


WEIGHTS = {
    "hook": 26.0,
    "intensity": 20.0,
    "narrative": 12.0,
    "density": 14.0,
    "standalone": 18.0,
    "duration": 10.0,
    "filler": -10.0,
}


def score_candidate(candidate: Candidate, units: list[Unit], i: int, j: int) -> Candidate:
    tokens = _tokens(candidate.text)
    features = {
        "hook": _hook_score(candidate.text),
        "intensity": _intensity_score(tokens),
        "narrative": _narrative_score(tokens),
        "density": _density_score(tokens, candidate.duration),
        "standalone": _standalone_score(units, i, j),
        "duration": _duration_score(candidate.duration),
        "filler": _filler_penalty(tokens),
    }
    total = sum(WEIGHTS[k] * v for k, v in features.items())
    candidate.features = features
    candidate.score = _clamp(total, 0.0, 100.0)
    candidate.title = suggest_title(candidate.text)
    candidate.reason = explain(features)
    return candidate


def suggest_title(text: str) -> str:
    """A first-pass title taken from the clip's own opening line."""
    opening = re.split(r"(?<=[.!?])\s+", text.strip())[0]
    words = opening.split()
    if len(words) > 12:
        opening = " ".join(words[:12]) + "…"
    opening = opening.strip(" ,;:-—")
    if not opening:
        return "Untitled clip"
    return opening[0].upper() + opening[1:]


def explain(features: dict[str, float]) -> str:
    notes: list[str] = []
    if features["hook"] > 0.5:
        notes.append("opens on a strong hook")
    if features["intensity"] > 0.5:
        notes.append("high-stakes language")
    if features["narrative"] > 0.5:
        notes.append("tells a story")
    if features["standalone"] > 0.7:
        notes.append("stands alone without context")
    if features["density"] > 0.7:
        notes.append("dense, little dead air")
    if features["filler"] > 0.5:
        notes.append("some filler words")
    if not notes:
        notes.append("steady delivery, moderate hook")
    return ", ".join(notes).capitalize() + "."
