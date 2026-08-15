"""What running this actually costs.

Three separate bills, and only one of them is under this code's control:

  1. Treblo        -- their plan. The real cap on throughput, and a number
                      only you know, so it's an input here rather than a guess.
  2. The machine   -- a VPS, or free if you use a spare laptop.
  3. Lyrics        -- zero with the built-in writer; per-generation if you
                      point it at Claude.

The third is the one that can surprise you. Generating flat out with an
expensive model costs far more than everything else combined, so this exists
to show that before you find out from a bill.
"""

from __future__ import annotations

from dataclasses import dataclass

# Per million tokens, from Anthropic's published pricing.
MODEL_PRICING = {
    "claude-opus-5": (5.00, 25.00),
    "claude-sonnet-5": (3.00, 15.00),
    "claude-haiku-4-5": (1.00, 5.00),
    "template": (0.0, 0.0),  # the built-in offline writer
}

# Measured against the prompts in lyrics.py: system prompt, tags, theme, and
# the avoid-list (capped at 60 prior bars). Output is the bars plus adaptive
# thinking, which dominates.
INPUT_TOKENS_PER_CALL = 1000
OUTPUT_TOKENS_PER_CALL = 1000

SONGS_PER_GENERATION = 2
AUTO_LYRICS_EVERY = 3


@dataclass
class CostEstimate:
    songs_per_day: int
    generations_per_day: float
    lyric_calls_per_day: float
    lyrics_per_day: float
    lyrics_per_month: float
    vps_per_month: float
    total_per_month: float
    model: str

    def report(self) -> str:
        lines = [
            f"At {self.songs_per_day} songs/day on {self.model}:",
            "",
            f"  generations/day      {self.generations_per_day:>10.0f}",
            f"  lyric API calls/day  {self.lyric_calls_per_day:>10.0f}"
            "   (every 3rd generation uses Treblo's Auto Lyrics)",
            "",
            f"  lyrics    /day       {self.lyrics_per_day:>10.2f} USD",
            f"  lyrics    /month     {self.lyrics_per_month:>10.2f} USD",
            f"  machine   /month     {self.vps_per_month:>10.2f} USD",
            f"  {'-' * 34}",
            f"  total     /month     {self.total_per_month:>10.2f} USD",
            "",
            "  Plus whatever Treblo charge for the plan that allows this many",
            "  songs -- that bill isn't visible from here, and it's usually the",
            "  binding constraint on throughput.",
        ]
        return "\n".join(lines)


def estimate(
    songs_per_day: int,
    model: str = "template",
    vps_per_month: float = 5.0,
    auto_lyrics_every: int = AUTO_LYRICS_EVERY,
) -> CostEstimate:
    if model not in MODEL_PRICING:
        raise ValueError(f"unknown model {model!r}; known: {sorted(MODEL_PRICING)}")

    input_price, output_price = MODEL_PRICING[model]
    generations = songs_per_day / SONGS_PER_GENERATION

    # Every Nth generation uses Treblo's own Auto Lyrics, so it costs nothing.
    custom_share = (auto_lyrics_every - 1) / auto_lyrics_every if auto_lyrics_every else 1.0
    calls = generations * custom_share

    per_call = (
        INPUT_TOKENS_PER_CALL * input_price / 1_000_000
        + OUTPUT_TOKENS_PER_CALL * output_price / 1_000_000
    )
    per_day = calls * per_call
    per_month = per_day * 30

    return CostEstimate(
        songs_per_day=songs_per_day,
        generations_per_day=generations,
        lyric_calls_per_day=calls,
        lyrics_per_day=per_day,
        lyrics_per_month=per_month,
        vps_per_month=vps_per_month,
        total_per_month=per_month + vps_per_month,
        model=model,
    )


def comparison_table(songs_per_day: int, vps_per_month: float = 5.0) -> str:
    rows = ["", f"  {'model':<18}{'lyrics/mo':>12}{'total/mo':>12}", f"  {'-' * 42}"]
    for model in ("template", "claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"):
        est = estimate(songs_per_day, model=model, vps_per_month=vps_per_month)
        lyrics = f"${est.lyrics_per_month:,.2f}"
        total = f"${est.total_per_month:,.2f}"
        rows.append(f"  {model:<18}{lyrics:>12}{total:>12}")
    return "\n".join(rows)
