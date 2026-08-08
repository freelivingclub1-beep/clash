"""Turn a video into a word-level transcript.

Two backends:

* ``youtube`` — parses YouTube's json3 caption track. Free and near-instant, and
  json3 already carries per-word offsets, so the karaoke captions line up.
* ``whisper`` — runs faster-whisper locally. Slower and needs the extra
  dependency, but works on any source and gives cleaner punctuation.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from . import config
from .models import Transcript, Word

_WS = re.compile(r"\s+")


def _clean(token: str) -> str:
    return _WS.sub(" ", token.replace("​", "")).strip()


def from_youtube_json3(path: Path) -> Transcript:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    words: list[Word] = []

    for event in data.get("events") or []:
        segs = event.get("segs")
        if not segs:
            continue
        event_start = float(event.get("tStartMs", 0)) / 1000.0
        event_dur = float(event.get("dDurationMs", 0)) / 1000.0

        # First pass: collect (text, start) for each non-empty segment.
        staged: list[tuple[str, float]] = []
        for seg in segs:
            text = _clean(seg.get("utf8", ""))
            if not text or text == "\n":
                continue
            start = event_start + float(seg.get("tOffsetMs", 0)) / 1000.0
            staged.append((text, start))

        # Second pass: a word ends where the next one begins.
        for i, (text, start) in enumerate(staged):
            if i + 1 < len(staged):
                end = staged[i + 1][1]
            else:
                end = event_start + event_dur if event_dur else start + 0.35
            # Auto-captions occasionally emit zero-length or inverted spans.
            end = max(end, start + 0.08)
            words.append(Word(text=text, start=start, end=end))

    words.sort(key=lambda w: w.start)
    # Auto-caption events overlap (the rolling two-line effect). Clamp so each
    # word's span stops where the next begins, otherwise captions double up.
    for i in range(len(words) - 1):
        if words[i].end > words[i + 1].start:
            words[i].end = max(words[i].start + 0.08, words[i + 1].start)

    if not words:
        raise RuntimeError("Caption track contained no words.")
    return Transcript(words=words, source="youtube-captions")


def from_whisper(media_path: Path) -> Transcript:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:  # pragma: no cover - depends on optional extra
        raise RuntimeError(
            "faster-whisper is not installed. Run: pip install -r requirements-whisper.txt"
        ) from exc

    device = config.WHISPER_DEVICE
    compute = config.WHISPER_COMPUTE
    if device == "auto":
        try:
            import torch  # noqa: F401

            import torch as _t

            device = "cuda" if _t.cuda.is_available() else "cpu"
        except Exception:
            device = "cpu"
    if compute == "default":
        compute = "float16" if device == "cuda" else "int8"

    model = WhisperModel(config.WHISPER_MODEL, device=device, compute_type=compute)
    segments, info = model.transcribe(
        str(media_path),
        word_timestamps=True,
        vad_filter=True,
        beam_size=5,
    )

    words: list[Word] = []
    for segment in segments:
        for w in segment.words or []:
            text = _clean(w.word)
            if not text:
                continue
            start = float(w.start)
            end = max(float(w.end), start + 0.05)
            words.append(Word(text=text, start=start, end=end))

    if not words:
        raise RuntimeError("Whisper produced no words — is there speech in this video?")
    return Transcript(words=words, source="whisper", language=getattr(info, "language", "en"))


def transcribe(
    media_path: Path | None,
    caption_path: Path | None,
    mode: str | None = None,
) -> Transcript:
    """Resolve the configured mode into an actual transcript."""
    mode = mode or config.TRANSCRIBE_MODE

    if mode in {"auto", "youtube"} and caption_path is not None:
        try:
            return from_youtube_json3(caption_path)
        except Exception:
            if mode == "youtube":
                raise

    if mode == "youtube":
        raise RuntimeError(
            "No YouTube caption track available for this video. "
            "Set CLASH_TRANSCRIBE=whisper to transcribe it locally instead."
        )

    if media_path is None:
        raise RuntimeError("Whisper needs the media file, but it was not downloaded.")
    return from_whisper(media_path)
