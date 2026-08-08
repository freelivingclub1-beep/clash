"""Cut a clip with ffmpeg, reframe it, and burn in the captions."""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from . import config

Progress = Callable[[float, str], None]

ASPECTS = {
    "vertical": (9, 16),
    "vertical_blur": (9, 16),
    "square": (1, 1),
    "original": None,
}


@dataclass
class RenderOptions:
    aspect: str = "vertical"        # vertical | vertical_blur | square | original
    captions: bool = True
    crf: int = 20
    preset: str = "veryfast"
    normalize_audio: bool = True
    target_height: int = 1920


class RenderError(RuntimeError):
    pass


def probe_dimensions(path: Path) -> tuple[int, int]:
    cmd = [
        config.FFPROBE, "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "json", str(path),
    ]
    try:
        raw = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
        stream = json.loads(raw)["streams"][0]
        return int(stream["width"]), int(stream["height"])
    except Exception:
        return 1920, 1080


def _even(value: int) -> int:
    value = int(round(value))
    return value if value % 2 == 0 else value + 1


def output_size(src_w: int, src_h: int, options: RenderOptions) -> tuple[int, int]:
    ratio = ASPECTS.get(options.aspect)
    if ratio is None:  # keep the source shape, capped on the long edge
        long_edge = max(src_w, src_h)
        cap = max(options.target_height, 1280)
        scale = min(1.0, cap / long_edge) if long_edge else 1.0
        return _even(src_w * scale), _even(src_h * scale)

    num, den = ratio
    height = options.target_height if den >= num else int(options.target_height * 0.5625)
    if options.aspect == "square":
        height = min(options.target_height, 1080)
    width = _even(height * num / den)
    return width, _even(height)


def escape_for_filter(path: Path | str) -> str:
    """Escape a path so it survives ffmpeg's filtergraph parser."""
    text = str(path)
    text = text.replace("\\", "\\\\")
    text = text.replace(":", "\\:")
    text = text.replace("'", "\\'")
    text = text.replace(",", "\\,")
    text = text.replace("[", "\\[").replace("]", "\\]")
    return text


def build_video_filter(
    out_w: int, out_h: int, options: RenderOptions, ass_path: Path | None
) -> str:
    burn = f",ass={escape_for_filter(ass_path)}" if ass_path else ""

    if options.aspect == "vertical_blur":
        return (
            f"[0:v]split=2[bg][fg];"
            f"[bg]scale={out_w}:{out_h}:force_original_aspect_ratio=increase,"
            f"crop={out_w}:{out_h},boxblur=luma_radius=32:luma_power=2,"
            f"eq=brightness=-0.06[bgb];"
            f"[fg]scale={out_w}:{out_h}:force_original_aspect_ratio=decrease[fgs];"
            f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1{burn}[v]"
        )

    if options.aspect == "original":
        return f"[0:v]scale={out_w}:{out_h},setsar=1{burn}[v]"

    return (
        f"[0:v]scale={out_w}:{out_h}:force_original_aspect_ratio=increase,"
        f"crop={out_w}:{out_h},setsar=1{burn}[v]"
    )


_TIME_RE = re.compile(r"out_time_ms=(\d+)")


def run_ffmpeg(cmd: list[str], duration: float, on_progress: Progress | None) -> None:
    process = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1
    )
    assert process.stdout is not None
    for line in process.stdout:
        match = _TIME_RE.search(line)
        if match and on_progress and duration > 0:
            done = int(match.group(1)) / 1_000_000.0
            on_progress(min(0.99, done / duration), "Rendering")
    process.wait()
    if process.returncode != 0:
        stderr = process.stderr.read() if process.stderr else ""
        raise RenderError(f"ffmpeg failed (exit {process.returncode}):\n{stderr.strip()[-2000:]}")


def render_clip(
    source: Path,
    start: float,
    end: float,
    out_path: Path,
    options: RenderOptions | None = None,
    ass_path: Path | None = None,
    on_progress: Progress | None = None,
) -> Path:
    options = options or RenderOptions()
    duration = max(0.1, end - start)
    src_w, src_h = probe_dimensions(source)
    out_w, out_h = output_size(src_w, src_h, options)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    video_filter = build_video_filter(out_w, out_h, options, ass_path if options.captions else None)

    cmd = [
        config.FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
        "-progress", "pipe:1", "-nostats",
        # -ss before -i seeks fast; ffmpeg still decodes from the nearest
        # keyframe onward, so the cut stays frame-accurate under re-encode.
        "-ss", f"{start:.3f}",
        "-i", str(source),
        "-t", f"{duration:.3f}",
        "-filter_complex", video_filter,
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", options.preset, "-crf", str(options.crf),
        "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
        "-movflags", "+faststart",
    ]
    if options.normalize_audio:
        cmd += ["-af", "loudnorm=I=-14:TP=-1.5:LRA=11"]
    cmd.append(str(out_path))

    run_ffmpeg(cmd, duration, on_progress)
    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RenderError("ffmpeg reported success but produced no output file.")
    return out_path
