"""Build burned-in karaoke ("jumping") captions as an ASS subtitle file.

Word-level timings from the transcript drive two styles:

* ``pop``    — a short phrase stays on screen; the word being spoken pops up in
               scale and switches to the accent colour. This is the look most
               short-form clips use.
* ``single`` — one word at a time, very large, bouncing in on each beat.

Both are rendered by libass inside ffmpeg, so there is no per-frame Python work.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .models import Word

# Longest a single caption group stays on screen, and how many words it holds.
GROUP_MAX_WORDS = 4
GROUP_MAX_SECONDS = 2.6
# Uppercase text at the default size fits roughly this many characters across a
# 1080-wide frame. Capping the group here keeps phrases on one line, which
# matters because the active word scales up and a wrapped line would reflow.
GROUP_MAX_CHARS = 19
# A pause at least this long always starts a new group.
GROUP_BREAK_GAP = 0.45


@dataclass
class CaptionStyle:
    style: str = "pop"           # "pop" | "single"
    font: str = "DejaVu Sans"
    font_size: int = 84          # at 1080x1920; scaled for other resolutions
    primary: str = "#FFFFFF"     # inactive words
    accent: str = "#FFE24B"      # word currently being spoken
    outline: str = "#000000"
    outline_width: float = 5.0
    shadow: float = 1.5
    uppercase: bool = True
    margin_v: int = 380          # distance from the bottom edge, in ASS units
    bounce: bool = True


def _ass_color(hex_color: str, alpha: int = 0) -> str:
    """#RRGGBB -> &HAABBGGRR& (ASS stores colours byte-reversed)."""
    value = hex_color.strip().lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    if len(value) != 6:
        raise ValueError(f"Expected a #RRGGBB colour, got {hex_color!r}")
    r, g, b = value[0:2], value[2:4], value[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper() + "&"


def _timestamp(seconds: float) -> str:
    seconds = max(0.0, seconds)
    centis = int(round(seconds * 100))
    h, rem = divmod(centis, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def _escape(text: str) -> str:
    return text.replace("\\", "/").replace("{", "(").replace("}", ")").replace("\n", " ")


def group_words(words: list[Word], style: CaptionStyle) -> list[list[Word]]:
    """Chunk words into caption groups on pauses, punctuation and length."""
    if style.style == "single":
        return [[w] for w in words]

    groups: list[list[Word]] = []
    current: list[Word] = []

    for i, word in enumerate(words):
        current.append(word)
        gap_after = words[i + 1].start - word.end if i + 1 < len(words) else 999.0
        span = word.end - current[0].start
        ends_phrase = word.text.rstrip().endswith((".", "!", "?", ",", ";", ":", "—"))
        # Width of the group as it will be drawn, including the spaces.
        chars = sum(len(w.text.strip()) for w in current) + len(current) - 1
        next_chars = len(words[i + 1].text.strip()) + 1 if i + 1 < len(words) else 0

        if (
            len(current) >= GROUP_MAX_WORDS
            or span >= GROUP_MAX_SECONDS
            or gap_after >= GROUP_BREAK_GAP
            or ends_phrase
            or chars + next_chars > GROUP_MAX_CHARS
            or i == len(words) - 1
        ):
            groups.append(current)
            current = []

    if current:
        groups.append(current)
    return groups


def _header(style: CaptionStyle, width: int, height: int) -> str:
    # The design size is 1080x1920; scale the type so vertical and landscape
    # renders end up with visually equivalent captions.
    scale = min(width / 1080, height / 1920) or 1.0
    size = max(18, int(style.font_size * scale))
    outline = max(1.0, style.outline_width * scale)
    shadow = max(0.0, style.shadow * scale)
    margin_v = max(20, int(style.margin_v * scale))
    side_margin = max(20, int(70 * scale))

    return "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            # 0 = balanced word wrap. The character cap above normally keeps a
            # group to one line; this is the backstop for an unusually long word.
            "WrapStyle: 0",
            "ScaledBorderAndShadow: yes",
            f"PlayResX: {width}",
            f"PlayResY: {height}",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
            "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
            "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
            "Alignment, MarginL, MarginR, MarginV, Encoding",
            (
                f"Style: Clash,{style.font},{size},"
                f"{_ass_color(style.primary)},{_ass_color(style.accent)},"
                f"{_ass_color(style.outline)},{_ass_color('#000000', 160)},"
                f"-1,0,0,0,100,100,0,0,1,{outline:.1f},{shadow:.1f},"
                f"2,{side_margin},{side_margin},{margin_v},1"
            ),
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, "
            "MarginV, Effect, Text",
        ]
    )


def _group_lines(
    group: list[Word],
    style: CaptionStyle,
    clip_start: float,
    clip_end: float,
) -> list[str]:
    """One Dialogue line per word, redrawing the group with a new active word."""
    accent = _ass_color(style.accent)
    primary = _ass_color(style.primary)
    lines: list[str] = []

    for k, active in enumerate(group):
        start = max(clip_start, active.start)
        if k + 1 < len(group):
            end = min(clip_end, max(start + 0.02, group[k + 1].start))
        else:
            end = min(clip_end, max(start + 0.02, active.end + 0.06))
        if end <= start:
            continue

        parts: list[str] = []
        for m, word in enumerate(group):
            text = _escape(word.text.strip())
            if style.uppercase:
                text = text.upper()
            if not text:
                continue
            if m == k:
                pop = (
                    r"\fscx118\fscy118\t(0,110,\fscx100\fscy100)"
                    if style.bounce
                    else ""
                )
                # The reset rides on the same token as the word, otherwise the
                # join puts a space on both sides of it and the gap doubles.
                parts.append(
                    "{" + f"\\c{accent}{pop}" + "}"
                    + text
                    + "{" + f"\\c{primary}\\fscx100\\fscy100" + "}"
                )
            else:
                parts.append(text)

        body = " ".join(parts)
        lines.append(
            "Dialogue: 0,"
            f"{_timestamp(start - clip_start)},{_timestamp(end - clip_start)},"
            f"Clash,,0,0,0,,{body}"
        )

    return lines


def build_ass(
    words: list[Word],
    clip_start: float,
    clip_end: float,
    out_path: Path,
    style: CaptionStyle | None = None,
    width: int = 1080,
    height: int = 1920,
) -> Path:
    """Write an ASS file whose timings are relative to ``clip_start``."""
    style = style or CaptionStyle()
    in_clip = [w for w in words if w.end > clip_start and w.start < clip_end]

    lines = [_header(style, width, height)]
    for group in group_words(in_clip, style):
        lines.extend(_group_lines(group, style, clip_start, clip_end))

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out_path
