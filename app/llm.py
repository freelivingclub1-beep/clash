"""Optional Claude re-ranking of the heuristic shortlist.

This is a *refinement* pass, not the engine. The heuristic scorer already
produced a shortlist of self-contained, well-bounded moments; Claude judges
which of them a viewer would actually stop scrolling for, and writes the title.
Because only the shortlist is sent (not the whole transcript), a typical
90-minute video costs a couple of cents.
"""

from __future__ import annotations

import json
import os

from . import config
from .models import Candidate

SYSTEM = """You are a short-form video editor. You are given candidate clips \
cut from one long video, each with a timestamp and its verbatim transcript.

Judge each candidate on whether a viewer scrolling a feed would stop and watch \
it to the end:

- Hook: does the first sentence create a question, tension or surprise?
- Payoff: does the clip resolve what it opened, inside the clip?
- Self-contained: can someone who never saw the source video follow it?
- Specificity: concrete numbers, names and stakes beat generalities.

Be discriminating. A score above 80 means you would genuinely publish it; most \
candidates in a typical video are 40-65. Do not inflate scores to be helpful — \
a flat list of high scores is useless to the editor.

Write each title as the on-screen text of the clip: under 60 characters, no \
clickbait punctuation, no emoji, and it must be true to what is actually said."""

SCHEMA = {
    "type": "object",
    "properties": {
        "clips": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "The candidate id being scored."},
                    "score": {"type": "integer", "description": "0-100 likelihood this performs."},
                    "title": {"type": "string", "description": "On-screen title, under 60 chars."},
                    "reason": {
                        "type": "string",
                        "description": "One sentence: why it works or why it does not.",
                    },
                },
                "required": ["id", "score", "title", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["clips"],
    "additionalProperties": False,
}


def _timestamp(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:d}:{s:02d}"


def _render_candidates(candidates: list[Candidate]) -> str:
    blocks = []
    for c in candidates:
        blocks.append(
            f"<candidate id=\"{c.id}\" start=\"{_timestamp(c.start)}\" "
            f"duration=\"{int(c.duration)}s\">\n{c.text}\n</candidate>"
        )
    return "\n\n".join(blocks)


def rerank(
    candidates: list[Candidate],
    video_title: str = "",
    model: str | None = None,
) -> list[Candidate]:
    """Re-score candidates with Claude. Returns them sorted best-first.

    Raises on API failure — the caller decides whether to fall back to the
    heuristic ordering.
    """
    if not candidates:
        return []

    import anthropic

    client = anthropic.Anthropic()
    model = model or config.LLM_MODEL

    prompt = (
        (f"Source video: {video_title}\n\n" if video_title else "")
        + "Score every candidate below. Return one entry per candidate id.\n\n"
        + _render_candidates(candidates)
    )

    with client.messages.stream(
        model=model,
        max_tokens=16000,
        system=SYSTEM,
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        message = stream.get_final_message()

    if message.stop_reason == "refusal":
        raise RuntimeError("The model declined to score this transcript.")

    text = next((b.text for b in message.content if b.type == "text"), "")
    if not text:
        raise RuntimeError("Empty response from the ranking model.")

    payload = json.loads(text)
    by_id = {c.id: c for c in candidates}
    scored: list[Candidate] = []

    for entry in payload.get("clips", []):
        candidate = by_id.get(entry.get("id"))
        if candidate is None:
            continue
        candidate.score = float(max(0, min(100, int(entry.get("score", 0)))))
        candidate.title = (entry.get("title") or candidate.title).strip()
        candidate.reason = (entry.get("reason") or candidate.reason).strip()
        candidate.ranked_by = "claude"
        scored.append(candidate)

    # Anything the model skipped keeps its heuristic score rather than vanishing.
    seen = {c.id for c in scored}
    scored.extend(c for c in candidates if c.id not in seen)
    return sorted(scored, key=lambda c: c.score, reverse=True)


def estimated_cost_note() -> str:
    if not os.getenv("ANTHROPIC_API_KEY") and not os.getenv("ANTHROPIC_AUTH_TOKEN"):
        return "No ANTHROPIC_API_KEY set — using the free heuristic ranker."
    return f"Claude re-ranking enabled ({config.LLM_MODEL})."
