"""Follow the speaker's face so the 9:16 crop doesn't cut them out of frame.

The naive approach — recentre the crop on every detected face position — looks
like handheld camera shake. Real editors hold a framing and then move
deliberately, so that is what this does:

1. Sample frames at a few per second and detect faces.
2. Reject outliers, then smooth the path hard.
3. Simplify the smoothed path to a handful of keyframes (Ramer-Douglas-Peucker),
   which turns continuous jitter into "hold, ease across, hold".
4. Emit those keyframes as a piecewise-linear ffmpeg crop expression, so the
   move happens inside the single existing encode pass.

Detection needs opencv (``pip install -r requirements-tracking.txt``). Without
it, or when too few frames contain a face, tracking reports failure and the
caller falls back to a centre crop.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator, Sequence

from . import config

# A detector takes a grayscale frame and returns (x, y, w, h) boxes.
Detector = Callable[["object"], Sequence[tuple[int, int, int, int]]]

SAMPLE_FPS = 4.0          # face positions per second of video
SAMPLE_WIDTH = 720        # frames are downscaled to this before detection
# Smallest detectable face, as a fraction of frame width. 0.035 reaches wide
# shots; going much below this starts matching background texture.
MIN_FACE_FRACTION = 0.035
MIN_DETECTION_RATE = 0.15  # below this, the track is not trustworthy
MEDIAN_WINDOW = 5    # kills single-frame misdetections
SMOOTH_WINDOW = 9    # ~2s at SAMPLE_FPS; removes head-bob without adding lag
# Path simplification tolerance, as a fraction of frame width. Larger means
# fewer, bigger moves. 0.035 keeps the camera still through normal head motion.
RDP_EPSILON = 0.035
MAX_KEYFRAMES = 24
# Faces sit slightly above centre; dead-centre framing looks bottom-heavy.
VERTICAL_BIAS = 0.42


class TrackingUnavailable(RuntimeError):
    """Raised when a face track could not be produced."""


@dataclass
class TrackPoint:
    t: float          # seconds from the start of the clip
    cx: float         # face centre, 0..1 across the source frame
    cy: float


@dataclass
class CropPath:
    """Piecewise-linear crop offsets, ready to hand to ffmpeg."""

    x_expr: str
    y_expr: str
    keyframes: int
    detection_rate: float


# --------------------------------------------------------------------------- #
# frame sampling
# --------------------------------------------------------------------------- #

def sample_frame_size(src_w: int, src_h: int, width: int = SAMPLE_WIDTH) -> tuple[int, int]:
    """Dimensions of a sampled frame. Height is rounded up to even for ffmpeg."""
    height = int(round(width * src_h / max(1, src_w)))
    height += height % 2
    return width, height


def sample_frames(
    video: Path, start: float, duration: float, src_w: int, src_h: int,
    fps: float = SAMPLE_FPS, width: int = SAMPLE_WIDTH,
) -> Iterator["object"]:
    """Yield downscaled grayscale frames as numpy arrays.

    Decoding is done by ffmpeg into a raw pipe rather than by opencv, which
    keeps seeking accurate and avoids depending on opencv's video backend.
    """
    import numpy as np

    width, height = sample_frame_size(src_w, src_h, width)
    frame_bytes = width * height

    cmd = [
        config.FFMPEG, "-v", "error", "-nostdin",
        "-ss", f"{start:.3f}", "-i", str(video), "-t", f"{duration:.3f}",
        "-vf", f"fps={fps},scale={width}:{height}",
        "-pix_fmt", "gray", "-f", "rawvideo", "-",
    ]
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert process.stdout is not None
    try:
        while True:
            buffer = process.stdout.read(frame_bytes)
            if len(buffer) < frame_bytes:
                break
            yield np.frombuffer(buffer, dtype=np.uint8).reshape(height, width)
    finally:
        process.stdout.close()
        process.wait()


# --------------------------------------------------------------------------- #
# detection
# --------------------------------------------------------------------------- #

def _haar_detector(cv2) -> Detector:
    """Haar cascades, which ship inside the OpenCV 4 wheel — no model download."""
    frontal = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    profile = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_profileface.xml"
    )
    if frontal.empty():
        raise TrackingUnavailable("opencv is installed but its cascade data is missing.")

    def detect(frame) -> list[tuple[int, int, int, int]]:
        height, width = frame.shape[:2]
        minimum = max(20, int(width * MIN_FACE_FRACTION))
        boxes = frontal.detectMultiScale(
            frame, scaleFactor=1.15, minNeighbors=6, minSize=(minimum, minimum)
        )
        if len(boxes) == 0 and not profile.empty():
            boxes = profile.detectMultiScale(
                frame, scaleFactor=1.15, minNeighbors=6, minSize=(minimum, minimum)
            )
        return [tuple(int(v) for v in box) for box in boxes]

    return detect


def _yunet_detector(cv2, model_path: Path) -> Detector:
    """YuNet DNN detector — more accurate, but the model is a separate file."""
    import numpy as np

    detector = cv2.FaceDetectorYN.create(str(model_path), "", (320, 320), 0.6)

    def detect(frame) -> list[tuple[int, int, int, int]]:
        height, width = frame.shape[:2]
        detector.setInputSize((width, height))
        # YuNet wants 3-channel input; our sampled frames are grayscale.
        colour = np.repeat(frame[:, :, None], 3, axis=2)
        _, faces = detector.detect(colour)
        if faces is None:
            return []
        return [tuple(int(v) for v in face[:4]) for face in faces]

    return detect


def default_detector() -> Detector:
    """Pick whichever face detector this OpenCV build actually provides."""
    try:
        import cv2
    except ImportError as exc:
        raise TrackingUnavailable(
            "Face tracking needs opencv. Run: pip install -r requirements-tracking.txt"
        ) from exc

    model = config.FACE_MODEL
    if model and Path(model).exists() and hasattr(cv2, "FaceDetectorYN"):
        return _yunet_detector(cv2, Path(model))

    # OpenCV 4 bundles the cascades, so this is the zero-setup path.
    if hasattr(cv2, "CascadeClassifier"):
        return _haar_detector(cv2)

    raise TrackingUnavailable(
        f"OpenCV {getattr(cv2, '__version__', '?')} has no bundled face detector "
        "(the Haar cascade API was removed in 5.0). Either install "
        "'opencv-python-headless>=4.8,<5', or download a YuNet model and set "
        "CLASH_FACE_MODEL to its path."
    )


def _pick_face(
    boxes: Sequence[tuple[int, int, int, int]],
    previous: tuple[float, float] | None,
    width: int,
    height: int,
) -> tuple[float, float]:
    """Choose one face per frame, preferring the subject we were already on.

    With two people on screen, always taking the largest box makes the crop
    ping-pong between them. Continuity with the previous frame wins unless the
    other face is substantially bigger.
    """
    scored: list[tuple[float, float, float]] = []
    for x, y, w, h in boxes:
        cx = (x + w / 2) / width
        cy = (y + h / 2) / height
        area = (w * h) / (width * height)
        if previous is None:
            score = area
        else:
            distance = abs(cx - previous[0]) + abs(cy - previous[1])
            score = area - distance * 0.45
        scored.append((score, cx, cy))
    _, cx, cy = max(scored, key=lambda item: item[0])
    return cx, cy


def detect_track(
    video: Path, start: float, duration: float, src_w: int, src_h: int,
    detector: Detector | None = None, fps: float = SAMPLE_FPS,
) -> list[TrackPoint]:
    """Sample the clip and return one point per frame that contained a face."""
    detector = detector or default_detector()
    points: list[TrackPoint] = []
    previous: tuple[float, float] | None = None
    total = 0

    for index, frame in enumerate(
        sample_frames(video, start, duration, src_w, src_h, fps=fps)
    ):
        total += 1
        height, width = frame.shape[:2]
        boxes = detector(frame)
        if not boxes:
            continue
        cx, cy = _pick_face(boxes, previous, width, height)
        previous = (cx, cy)
        points.append(TrackPoint(t=index / fps, cx=cx, cy=cy))

    if total == 0:
        raise TrackingUnavailable("No frames could be decoded from the clip.")
    rate = len(points) / total
    if rate < MIN_DETECTION_RATE:
        raise TrackingUnavailable(
            f"A face was found in only {rate:.0%} of sampled frames — "
            "falling back to a centre crop."
        )
    return points


# --------------------------------------------------------------------------- #
# smoothing and simplification
# --------------------------------------------------------------------------- #

def _median(values: list[float], window: int) -> list[float]:
    if window < 3 or len(values) < window:
        return list(values)
    half = window // 2
    out = []
    for i in range(len(values)):
        lo, hi = max(0, i - half), min(len(values), i + half + 1)
        chunk = sorted(values[lo:hi])
        out.append(chunk[len(chunk) // 2])
    return out


def _moving_average(values: list[float], window: int) -> list[float]:
    """Centred moving average with a symmetrically shrinking window.

    Keeping the window symmetric about each sample matters: it introduces no
    lag, and it reproduces a linear ramp exactly, including at the endpoints.
    An exponential filter (even run forwards then backwards) drags the ends of
    a pan toward the middle, which shows up as the crop trailing the subject at
    the start and stopping short at the end.
    """
    count = len(values)
    if window < 3 or count < 3:
        return list(values)
    half = window // 2
    out: list[float] = []
    for i in range(count):
        reach = min(half, i, count - 1 - i)
        chunk = values[i - reach : i + reach + 1]
        out.append(sum(chunk) / len(chunk))
    return out


def smooth_track(points: list[TrackPoint]) -> list[TrackPoint]:
    if not points:
        return []
    xs = _moving_average(_median([p.cx for p in points], MEDIAN_WINDOW), SMOOTH_WINDOW)
    ys = _moving_average(_median([p.cy for p in points], MEDIAN_WINDOW), SMOOTH_WINDOW)
    return [TrackPoint(t=p.t, cx=x, cy=y) for p, x, y in zip(points, xs, ys)]


def _rdp(series: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    """Ramer-Douglas-Peucker on a time series, using vertical distance.

    Collapses long stretches of near-constant position into a single held
    segment, which is exactly the "hold, move, hold" shape we want.
    """
    if len(series) < 3:
        return list(series)

    (t0, v0), (t1, v1) = series[0], series[-1]
    span = t1 - t0
    worst_index, worst_distance = 0, -1.0

    for i in range(1, len(series) - 1):
        t, v = series[i]
        expected = v0 if span <= 0 else v0 + (v1 - v0) * (t - t0) / span
        distance = abs(v - expected)
        if distance > worst_distance:
            worst_index, worst_distance = i, distance

    if worst_distance <= epsilon:
        return [series[0], series[-1]]

    left = _rdp(series[: worst_index + 1], epsilon)
    right = _rdp(series[worst_index:], epsilon)
    return left[:-1] + right


def simplify(
    series: list[tuple[float, float]],
    epsilon: float = RDP_EPSILON,
    max_points: int = MAX_KEYFRAMES,
) -> list[tuple[float, float]]:
    """Simplify, loosening the tolerance until the keyframe budget is met."""
    if len(series) <= 2:
        return list(series)
    result = _rdp(series, epsilon)
    while len(result) > max_points and epsilon < 1.0:
        epsilon *= 1.6
        result = _rdp(series, epsilon)
    return result


# --------------------------------------------------------------------------- #
# ffmpeg expression
# --------------------------------------------------------------------------- #

def _piecewise(keyframes: list[tuple[float, float]]) -> str:
    """Nested if() giving linear interpolation between keyframes.

    Commas are backslash-escaped throughout. The renderer also wraps the whole
    expression in quotes, but escaping means it stays valid either way rather
    than silently splitting the filtergraph if the quotes are ever dropped.
    """
    if not keyframes:
        return "0"
    if len(keyframes) == 1:
        return f"{keyframes[0][1]:.1f}"

    expression = f"{keyframes[-1][1]:.1f}"
    for (t0, v0), (t1, v1) in reversed(list(zip(keyframes, keyframes[1:]))):
        span = max(1e-3, t1 - t0)
        ramp = f"{v0:.1f}+({v1 - v0:.1f})*(t-{t0:.3f})/{span:.3f}"
        expression = f"if(lt(t\\,{t1:.3f})\\,{ramp}\\,{expression})"
    # Anything before the first keyframe holds the opening framing.
    t_first, v_first = keyframes[0]
    return f"if(lt(t\\,{t_first:.3f})\\,{v_first:.1f}\\,{expression})"


def _clamped(expression: str, axis: str) -> str:
    """Keep the crop window inside the frame regardless of the path."""
    limit = f"in_{axis}-out_{axis}"
    return f"max(0\\,min({limit}\\,{expression}))"


def build_crop_path(
    points: list[TrackPoint],
    src_w: int, src_h: int,
    out_w: int, out_h: int,
    detection_rate: float = 1.0,
) -> CropPath:
    """Turn a detected track into clamped ffmpeg crop expressions.

    The render scales the source up until it covers ``out_w`` x ``out_h``, so
    face positions are mapped through that same scale factor before becoming
    pixel offsets.
    """
    if not points:
        raise TrackingUnavailable("No track points to build a crop path from.")

    scale = max(out_w / src_w, out_h / src_h)
    scaled_w, scaled_h = src_w * scale, src_h * scale

    smoothed = smooth_track(points)
    x_series = simplify([(p.t, p.cx) for p in smoothed])
    y_series = simplify([(p.t, p.cy) for p in smoothed])

    x_keys = [(t, cx * scaled_w - out_w / 2) for t, cx in x_series]
    y_keys = [(t, cy * scaled_h - out_h * VERTICAL_BIAS) for t, cy in y_series]

    return CropPath(
        x_expr=_clamped(_piecewise(x_keys), "w"),
        y_expr=_clamped(_piecewise(y_keys), "h"),
        keyframes=max(len(x_keys), len(y_keys)),
        detection_rate=detection_rate,
    )


def track_clip(
    video: Path, start: float, duration: float,
    src_w: int, src_h: int, out_w: int, out_h: int,
    detector: Detector | None = None,
) -> CropPath:
    """Convenience wrapper: detect, smooth, simplify, and build the expression."""
    points = detect_track(video, start, duration, src_w, src_h, detector=detector)
    sampled = int(duration * SAMPLE_FPS) or 1
    rate = min(1.0, len(points) / sampled)
    return build_crop_path(points, src_w, src_h, out_w, out_h, detection_rate=rate)


def available() -> bool:
    try:
        default_detector()
    except TrackingUnavailable:
        return False
    return True
