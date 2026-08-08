"""Runtime configuration, all overridable by environment variable."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("CLASH_DATA_DIR", ROOT / "data"))
SOURCE_DIR = DATA_DIR / "sources"
CLIP_DIR = DATA_DIR / "clips"
CACHE_DIR = DATA_DIR / "cache"

for _d in (SOURCE_DIR, CLIP_DIR, CACHE_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# --- clip length bounds (seconds) -------------------------------------------
MIN_CLIP_SECONDS = float(os.getenv("CLASH_MIN_CLIP", "15"))
MAX_CLIP_SECONDS = float(os.getenv("CLASH_MAX_CLIP", "180"))

# Clips are padded slightly so speech is not clipped at the boundaries.
LEAD_IN = float(os.getenv("CLASH_LEAD_IN", "0.25"))
LEAD_OUT = float(os.getenv("CLASH_LEAD_OUT", "0.45"))

# --- transcription ----------------------------------------------------------
# auto  -> try YouTube's own captions (free, instant), fall back to whisper
# youtube -> captions only
# whisper -> local whisper only (most accurate word timings)
TRANSCRIBE_MODE = os.getenv("CLASH_TRANSCRIBE", "auto")
WHISPER_MODEL = os.getenv("CLASH_WHISPER_MODEL", "small")
WHISPER_DEVICE = os.getenv("CLASH_WHISPER_DEVICE", "auto")
WHISPER_COMPUTE = os.getenv("CLASH_WHISPER_COMPUTE", "default")
SUBTITLE_LANGS = os.getenv("CLASH_SUB_LANGS", "en,en-US,en-GB").split(",")

# --- ranking ----------------------------------------------------------------
# heuristic -> free, offline, no API key
# llm       -> Claude re-ranks the heuristic shortlist (costs a few cents)
RANKER = os.getenv("CLASH_RANKER", "heuristic")
LLM_MODEL = os.getenv("CLASH_LLM_MODEL", "claude-opus-5")

# --- media ------------------------------------------------------------------
MAX_SOURCE_HEIGHT = int(os.getenv("CLASH_MAX_HEIGHT", "1080"))
FFMPEG = os.getenv("CLASH_FFMPEG", "ffmpeg")
FFPROBE = os.getenv("CLASH_FFPROBE", "ffprobe")
FONTS_DIR = os.getenv("CLASH_FONTS_DIR", "")
CAPTION_FONT = os.getenv("CLASH_CAPTION_FONT", "DejaVu Sans")

# Optional YuNet .onnx face model. Only needed on OpenCV 5, which dropped the
# bundled Haar cascades; on OpenCV 4 face tracking works with no model file.
FACE_MODEL = os.getenv("CLASH_FACE_MODEL", "")

# How many candidate clips to surface.
MAX_RESULTS = int(os.getenv("CLASH_MAX_RESULTS", "12"))
# Fraction of overlap above which two candidates are considered the same clip.
NMS_OVERLAP = float(os.getenv("CLASH_NMS_OVERLAP", "0.4"))


def ffmpeg_available() -> bool:
    return shutil.which(FFMPEG) is not None


def whisper_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
    except Exception:
        return False
    return True


def anthropic_available() -> bool:
    if not (os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN")):
        return False
    try:
        import anthropic  # noqa: F401
    except Exception:
        return False
    return True
