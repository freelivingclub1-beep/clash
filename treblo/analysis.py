"""Work out what each song actually *is* — key, BPM, feel.

A title tells you nothing about a track you've never heard. This pulls the
musical fingerprint off each finished song so the library reads like

    #41  done  [yeat,cloud rap,piano]  F# minor  142 BPM  2:11  dark

instead of "Untitled fake-12-0".

Crucially it does NOT keep the audio. The file is streamed to a temp path,
measured, and deleted in a finally block — the numbers are a few hundred
bytes, the MP3 is megabytes. That's the whole point of not storing audio
locally, and it would be self-defeating to break it here.

librosa is an optional dependency. Without it everything else still works;
you just don't get features. Install with:

    pip install librosa
"""

from __future__ import annotations

import os
import tempfile
import urllib.request
from dataclasses import asdict, dataclass
from typing import Protocol

PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Schmuckler key profiles: how strongly each scale degree is
# expected to appear in a major / minor key. Correlating a song's pitch-class
# histogram against all 24 rotations of these gives the key.
KRUMHANSL_MAJOR = (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
KRUMHANSL_MINOR = (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)


@dataclass
class AudioFeatures:
    bpm: float | None = None
    key: str | None = None          # "F#"
    mode: str | None = None         # "major" / "minor"
    key_confidence: float | None = None
    duration_s: float | None = None
    loudness_db: float | None = None
    brightness: float | None = None  # spectral centroid, Hz -- "dark" vs "bright"
    energy: float | None = None      # 0..1, how hard it hits

    @property
    def key_name(self) -> str | None:
        if not self.key or not self.mode:
            return None
        return f"{self.key} {self.mode}"

    def summary(self) -> str:
        bits = []
        if self.key_name:
            bits.append(self.key_name)
        if self.bpm:
            bits.append(f"{self.bpm:.0f} BPM")
        if self.duration_s:
            bits.append(f"{int(self.duration_s // 60)}:{int(self.duration_s % 60):02d}")
        if self.brightness:
            bits.append(describe_brightness(self.brightness))
        return "  ".join(bits) if bits else "not analysed"

    def to_dict(self) -> dict:
        return asdict(self)


def describe_brightness(centroid_hz: float) -> str:
    """Plain-language read on the spectral centroid."""
    if centroid_hz < 1200:
        return "dark"
    if centroid_hz < 2200:
        return "warm"
    if centroid_hz < 3400:
        return "bright"
    return "harsh"


def _correlate(a: tuple[float, ...] | list[float], b: tuple[float, ...] | list[float]) -> float:
    """Pearson correlation, stdlib only so key detection stays testable."""
    n = len(a)
    mean_a, mean_b = sum(a) / n, sum(b) / n
    da = [x - mean_a for x in a]
    db = [y - mean_b for y in b]
    num = sum(x * y for x, y in zip(da, db))
    den = (sum(x * x for x in da) ** 0.5) * (sum(y * y for y in db) ** 0.5)
    return num / den if den else 0.0


def detect_key(chroma: list[float]) -> tuple[str, str, float]:
    """Pick the best key from a 12-bin pitch-class histogram.

    Returns (pitch class, mode, confidence). Confidence is the margin between
    the winner and runner-up, so a song that sits ambiguously between relative
    major and minor reports low confidence rather than false certainty.
    """
    if len(chroma) != 12:
        raise ValueError("chroma must have 12 bins")

    scored: list[tuple[float, str, str]] = []
    for tonic in range(12):
        rotated = chroma[tonic:] + chroma[:tonic]
        scored.append((_correlate(rotated, KRUMHANSL_MAJOR), PITCH_CLASSES[tonic], "major"))
        scored.append((_correlate(rotated, KRUMHANSL_MINOR), PITCH_CLASSES[tonic], "minor"))

    scored.sort(reverse=True, key=lambda s: s[0])
    best, runner_up = scored[0], scored[1]
    confidence = max(0.0, min(1.0, best[0] - runner_up[0]))
    return best[1], best[2], confidence


class Analyzer(Protocol):
    def analyze(self, url: str) -> AudioFeatures:
        ...


class NullAnalyzer:
    """Does nothing. The default, so librosa stays optional."""

    def analyze(self, url: str) -> AudioFeatures:
        return AudioFeatures()


class LibrosaAnalyzer:
    """Downloads a song, measures it, deletes it.

    Costs CPU and a few MB of transient disk per song. On a 1GB VPS this
    works but is not fast -- budget roughly the length of the song. Set
    `analyze=False` on the runner if the box is too small.
    """

    def __init__(self, timeout: float = 60.0, sample_rate: int = 22050) -> None:
        self.timeout = timeout
        self.sample_rate = sample_rate

    def analyze(self, url: str) -> AudioFeatures:
        path = self._download(url)
        try:
            return self._measure(path)
        finally:
            # Never leave audio on disk, even if analysis blew up.
            try:
                os.unlink(path)
            except OSError:
                pass

    def _download(self, url: str) -> str:
        fd, path = tempfile.mkstemp(suffix=".audio")
        os.close(fd)
        with urllib.request.urlopen(url, timeout=self.timeout) as response:
            with open(path, "wb") as handle:
                while chunk := response.read(65536):
                    handle.write(chunk)
        return path

    def _measure(self, path: str) -> AudioFeatures:
        try:
            import librosa
            import numpy as np
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise RuntimeError(
                "Audio analysis needs librosa. Install it with:\n"
                "    pip install librosa\n"
                "or run with --no-analyze."
            ) from exc

        y, sr = librosa.load(path, sr=self.sample_rate, mono=True)
        if y.size == 0:
            return AudioFeatures()

        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_mean = chroma.mean(axis=1)
        key, mode, confidence = detect_key([float(v) for v in chroma_mean])

        rms = float(np.sqrt(np.mean(y**2)))
        centroid = float(librosa.feature.spectral_centroid(y=y, sr=sr).mean())

        return AudioFeatures(
            bpm=float(np.atleast_1d(tempo)[0]),
            key=key,
            mode=mode,
            key_confidence=round(confidence, 3),
            duration_s=round(len(y) / sr, 2),
            loudness_db=round(20 * float(np.log10(rms)) if rms > 0 else -80.0, 2),
            brightness=round(centroid, 1),
            energy=round(min(1.0, rms * 4), 3),
        )
