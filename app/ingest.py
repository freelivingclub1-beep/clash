"""Fetch metadata, media and (where available) YouTube's own caption track."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable

from yt_dlp import YoutubeDL

from . import config
from .models import SourceVideo

Progress = Callable[[float, str], None]

_URL_RE = re.compile(r"https?://\S+")


def normalize_url(raw: str) -> str:
    """Accept a bare ID, a pasted URL, or a URL buried in surrounding text."""
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("No URL provided.")
    match = _URL_RE.search(raw)
    if match:
        return match.group(0).rstrip(".,)>\"'")
    if re.fullmatch(r"[\w-]{11}", raw):
        return f"https://www.youtube.com/watch?v={raw}"
    raise ValueError(f"Could not find a video URL in: {raw!r}")


def _base_opts() -> dict[str, Any]:
    return {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "ignoreerrors": False,
        # Some sites rate-limit aggressively; a couple of retries smooths that out.
        "retries": 3,
        "fragment_retries": 3,
    }


def probe(url: str) -> SourceVideo:
    """Read metadata without downloading anything."""
    opts = _base_opts() | {"skip_download": True}
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if info is None:
        raise RuntimeError("The video could not be read (private, removed or geo-blocked).")
    if info.get("_type") == "playlist":
        entries = [e for e in (info.get("entries") or []) if e]
        if not entries:
            raise RuntimeError("That playlist is empty.")
        info = entries[0]
    return SourceVideo(
        video_id=str(info.get("id") or "video"),
        title=info.get("title") or "Untitled",
        url=info.get("webpage_url") or url,
        path=None,
        duration=float(info.get("duration") or 0.0),
        uploader=info.get("uploader") or "",
        thumbnail=info.get("thumbnail") or "",
    )


def fetch_captions(url: str, video_id: str) -> Path | None:
    """Download YouTube's caption track in json3 form.

    json3 carries per-word offsets inside each caption event, which is exactly
    what the karaoke captions need — and it costs nothing and takes a second.
    Returns None when the video has no usable caption track.
    """
    out_dir = config.CACHE_DIR / video_id
    out_dir.mkdir(parents=True, exist_ok=True)

    opts = _base_opts() | {
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitlesformat": "json3",
        "subtitleslangs": config.SUBTITLE_LANGS + ["en.*"],
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
    }
    try:
        with YoutubeDL(opts) as ydl:
            ydl.extract_info(url, download=True)
    except Exception:
        return None

    candidates = sorted(out_dir.glob("*.json3"))
    for path in candidates:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if data.get("events"):
            return path
    return None


def download_media(url: str, video_id: str, on_progress: Progress | None = None) -> Path:
    """Download the video itself, capped at MAX_SOURCE_HEIGHT."""
    out_dir = config.SOURCE_DIR / video_id
    out_dir.mkdir(parents=True, exist_ok=True)

    existing = [p for p in out_dir.iterdir() if p.suffix in {".mp4", ".mkv", ".webm"}]
    if existing:
        return existing[0]

    height = config.MAX_SOURCE_HEIGHT

    def hook(status: dict[str, Any]) -> None:
        if on_progress is None or status.get("status") != "downloading":
            return
        total = status.get("total_bytes") or status.get("total_bytes_estimate") or 0
        done = status.get("downloaded_bytes") or 0
        if total:
            on_progress(done / total, "Downloading video")

    opts = _base_opts() | {
        "format": (
            f"bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/"
            f"bestvideo[height<={height}]+bestaudio/best[height<={height}]/best"
        ),
        "merge_output_format": "mp4",
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
        "progress_hooks": [hook],
    }
    with YoutubeDL(opts) as ydl:
        ydl.extract_info(url, download=True)

    files = [p for p in out_dir.iterdir() if p.suffix in {".mp4", ".mkv", ".webm"}]
    if not files:
        raise RuntimeError("Download finished but no media file was produced.")
    return files[0]
