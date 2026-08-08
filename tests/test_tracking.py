"""Face tracking: the pure maths, and a real render that must follow a subject.

Haar detection accuracy is tested separately against a genuine photograph. The
end-to-end tests inject a simple blob detector instead, so they are deterministic
and still exercise the whole chain: frame sampling, smoothing, path
simplification, the ffmpeg crop expression, and the encode itself.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config, render, tracking  # noqa: E402
from app.tracking import TrackPoint  # noqa: E402

HAS_FFMPEG = shutil.which(config.FFMPEG) is not None

SRC_W, SRC_H = 1280, 720
OUT_W, OUT_H = 1080, 1920
BLOB = 140          # size of the moving square, in source pixels
PAN_START, PAN_END = 220, 1040   # x centre travels between these
CLIP_SECONDS = 8.0


# --------------------------------------------------------------------------- #
# fixtures: a video with a subject that moves, and a detector that finds it
# --------------------------------------------------------------------------- #

def blob_detector(frame):
    """Locate the bright square. Stands in for a face detector in tests."""
    import numpy as np

    mask = frame > 160
    columns = np.where(mask.any(axis=0))[0]
    rows = np.where(mask.any(axis=1))[0]
    if columns.size == 0 or rows.size == 0:
        return []
    x0, x1 = int(columns[0]), int(columns[-1])
    y0, y1 = int(rows[0]), int(rows[-1])
    return [(x0, y0, x1 - x0 + 1, y1 - y0 + 1)]


def blob_centre(frame) -> tuple[float, float] | None:
    boxes = blob_detector(frame)
    if not boxes:
        return None
    x, y, w, h = boxes[0]
    return x + w / 2, y + h / 2


@pytest.fixture(scope="module")
def panning_video(tmp_path_factory) -> Path:
    """A subject that starts left of centre and travels to the right."""
    import numpy as np

    path = tmp_path_factory.mktemp("track") / "pan.mp4"
    fps = 25
    frames = int(CLIP_SECONDS * fps)

    process = subprocess.Popen(
        [
            config.FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "gray",
            "-s", f"{SRC_W}x{SRC_H}", "-r", str(fps), "-i", "-",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-crf", "18", str(path),
        ],
        stdin=subprocess.PIPE,
    )
    assert process.stdin is not None
    for i in range(frames):
        frame = np.full((SRC_H, SRC_W), 30, dtype=np.uint8)
        progress = i / max(1, frames - 1)
        cx = int(PAN_START + (PAN_END - PAN_START) * progress)
        cy = SRC_H // 2
        frame[cy - BLOB // 2 : cy + BLOB // 2, cx - BLOB // 2 : cx + BLOB // 2] = 255
        process.stdin.write(frame.tobytes())
    process.stdin.close()
    process.wait()
    assert path.exists()
    return path


# --------------------------------------------------------------------------- #
# pure maths
# --------------------------------------------------------------------------- #

def test_smoothing_is_lag_free_and_preserves_a_ramp():
    """A pan must survive smoothing intact — ends included, not just the middle.

    The first implementation used a forward-backward exponential filter, which
    dragged both ends of a ramp toward its mean; the crop then started late and
    stopped short of the subject.
    """
    values = [float(i) for i in range(40)]
    smoothed = tracking._moving_average(values, tracking.SMOOTH_WINDOW)
    for original, result in zip(values, smoothed):
        assert abs(result - original) < 0.01


def test_smoothing_removes_jitter():
    values = [0.5 + (0.06 if i % 2 else -0.06) for i in range(40)]
    smoothed = tracking._moving_average(values, tracking.SMOOTH_WINDOW)
    interior = smoothed[5:-5]
    assert max(abs(v - 0.5) for v in interior) < 0.02


def test_median_rejects_a_spike():
    values = [0.5] * 10
    values[5] = 0.95  # single-frame misdetection
    filtered = tracking._median(values, 5)
    assert max(filtered) < 0.6


def test_rdp_collapses_a_flat_series():
    series = [(i * 0.25, 0.5) for i in range(40)]
    assert len(tracking._rdp(series, 0.01)) == 2


def test_rdp_keeps_a_real_move():
    series = [(i * 0.25, 0.2 if i < 20 else 0.8) for i in range(40)]
    simplified = tracking._rdp(series, 0.05)
    assert len(simplified) >= 3
    assert simplified[0][1] == pytest.approx(0.2)
    assert simplified[-1][1] == pytest.approx(0.8)


def test_simplify_respects_the_keyframe_budget():
    import math

    series = [(i * 0.1, 0.5 + 0.4 * math.sin(i * 0.7)) for i in range(400)]
    simplified = tracking.simplify(series, epsilon=0.001, max_points=12)
    assert len(simplified) <= 12


def test_piecewise_interpolates_between_keyframes():
    expr = tracking._piecewise([(0.0, 100.0), (2.0, 300.0)])
    assert "if(lt(t\\," in expr
    # linear ramp from the first keyframe value to the second
    assert "100.0+(200.0)*(t-0.000)/2.000" in expr


def test_piecewise_handles_a_single_keyframe():
    assert tracking._piecewise([(0.0, 42.0)]) == "42.0"


def test_crop_expressions_are_clamped_to_the_frame():
    points = [TrackPoint(t=i / 4, cx=0.99, cy=0.99) for i in range(20)]
    path = tracking.build_crop_path(points, SRC_W, SRC_H, OUT_W, OUT_H)
    assert "max(0" in path.x_expr and "min(in_w-out_w" in path.x_expr
    assert "min(in_h-out_h" in path.y_expr


def test_crop_expression_escapes_every_comma():
    """An unescaped comma would split the filtergraph if the quotes were lost."""
    points = [TrackPoint(t=i / 4, cx=0.3 + i * 0.02, cy=0.5) for i in range(20)]
    path = tracking.build_crop_path(points, SRC_W, SRC_H, OUT_W, OUT_H)
    for expr in (path.x_expr, path.y_expr):
        assert "if(lt(" in expr
        bare = expr.replace("\\,", "")
        assert "," not in bare, f"unescaped comma in {expr}"


def test_pick_face_prefers_continuity_over_size():
    """Two speakers: don't jump to the bigger face and ping-pong."""
    boxes = [(10, 100, 60, 60), (700, 100, 90, 90)]  # small-left, big-right
    cx, _ = tracking._pick_face(boxes, previous=(0.06, 0.5), width=800, height=400)
    assert cx < 0.3, "should have stayed on the face it was already following"


def test_pick_face_without_history_takes_the_largest():
    boxes = [(10, 100, 60, 60), (700, 100, 90, 90)]
    cx, _ = tracking._pick_face(boxes, previous=None, width=800, height=400)
    assert cx > 0.7


def test_vertical_bias_puts_the_face_above_centre():
    points = [TrackPoint(t=i / 4, cx=0.5, cy=0.5) for i in range(12)]
    path = tracking.build_crop_path(points, 1080, 1920, 1080, 1080)
    # y offset for a centred face should exceed the naive centre offset,
    # i.e. the crop window sits lower, leaving headroom above the face.
    naive = 0.5 * 1920 - 1080 / 2
    biased = 0.5 * 1920 - 1080 * tracking.VERTICAL_BIAS
    assert biased > naive
    assert f"{biased:.1f}" in path.y_expr


def test_build_crop_path_rejects_an_empty_track():
    with pytest.raises(tracking.TrackingUnavailable):
        tracking.build_crop_path([], SRC_W, SRC_H, OUT_W, OUT_H)


# --------------------------------------------------------------------------- #
# sampling and detection against a real video
# --------------------------------------------------------------------------- #

@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
def test_sample_frames_shape_and_count(panning_video: Path):
    frames = list(
        tracking.sample_frames(panning_video, 0.0, CLIP_SECONDS, SRC_W, SRC_H, fps=4)
    )
    assert len(frames) >= int(CLIP_SECONDS * 4) - 2
    width, height = tracking.sample_frame_size(SRC_W, SRC_H)
    assert frames[0].shape == (height, width)
    assert height % 2 == 0, "ffmpeg rejects odd dimensions"


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
def test_detect_track_follows_the_subject(panning_video: Path):
    points = tracking.detect_track(
        panning_video, 0.0, CLIP_SECONDS, SRC_W, SRC_H, detector=blob_detector, fps=4
    )
    assert len(points) > 20
    assert points[0].cx < 0.3, "subject starts left of centre"
    assert points[-1].cx > 0.7, "subject ends right of centre"
    # Monotonic pan, so the track should be monotonic too (within noise).
    assert points[-1].cx > points[0].cx


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
def test_track_fails_cleanly_when_nothing_is_detected(panning_video: Path):
    with pytest.raises(tracking.TrackingUnavailable, match="falling back"):
        tracking.detect_track(
            panning_video, 0.0, CLIP_SECONDS, SRC_W, SRC_H,
            detector=lambda frame: [], fps=4,
        )


# --------------------------------------------------------------------------- #
# the payoff: does the rendered clip actually keep the subject in frame?
# --------------------------------------------------------------------------- #

def _subject_offsets(clip: Path, out_w: int, out_h: int) -> list[float]:
    """Horizontal distance from frame centre, 0..1, for each sampled output frame."""
    offsets = []
    for frame in tracking.sample_frames(clip, 0.0, CLIP_SECONDS, out_w, out_h, fps=4):
        centre = blob_centre(frame)
        if centre is None:
            offsets.append(1.0)  # subject left the frame entirely
            continue
        height, width = frame.shape[:2]
        offsets.append(abs(centre[0] / width - 0.5) * 2)
    return offsets


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
def test_tracked_render_keeps_the_subject_centred(panning_video: Path, tmp_path: Path):
    path = tracking.track_clip(
        panning_video, 0.0, CLIP_SECONDS, SRC_W, SRC_H, OUT_W, OUT_H,
        detector=blob_detector,
    )
    out = render.render_clip(
        source=panning_video, start=0.0, end=CLIP_SECONDS,
        out_path=tmp_path / "tracked.mp4",
        options=render.RenderOptions(aspect="vertical", captions=False,
                                     normalize_audio=False, face_track=True),
        crop_path=path,
    )
    assert render.probe_dimensions(out) == (OUT_W, OUT_H)

    offsets = _subject_offsets(out, OUT_W, OUT_H)
    assert offsets, "no frames sampled from the render"
    # The subject should stay near the middle for the whole pan.
    assert max(offsets) < 0.45, f"subject drifted to {max(offsets):.2f} of half-width"
    assert sum(offsets) / len(offsets) < 0.2


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
def test_centre_crop_loses_the_subject(panning_video: Path, tmp_path: Path):
    """Control: without tracking the same pan must fall out of frame.

    If this ever passes, the tracking test above proves nothing.
    """
    out = render.render_clip(
        source=panning_video, start=0.0, end=CLIP_SECONDS,
        out_path=tmp_path / "centred.mp4",
        options=render.RenderOptions(aspect="vertical", captions=False,
                                     normalize_audio=False, face_track=False),
    )
    offsets = _subject_offsets(out, OUT_W, OUT_H)
    assert max(offsets) > 0.9, "expected the subject to leave a static centre crop"


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
def test_tracking_uses_few_keyframes(panning_video: Path):
    """A smooth pan should become a handful of moves, not one per sample."""
    path = tracking.track_clip(
        panning_video, 0.0, CLIP_SECONDS, SRC_W, SRC_H, OUT_W, OUT_H,
        detector=blob_detector,
    )
    assert 2 <= path.keyframes <= tracking.MAX_KEYFRAMES
    assert path.detection_rate > 0.9


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
def test_render_falls_back_to_centre_when_tracking_fails(
    panning_video: Path, tmp_path: Path, monkeypatch
):
    """A clip with no detectable face must still render, just centred."""
    def explode(*args, **kwargs):
        raise tracking.TrackingUnavailable("no faces here")

    monkeypatch.setattr(tracking, "track_clip", explode)
    messages: list[str] = []
    out = render.render_clip(
        source=panning_video, start=0.0, end=3.0,
        out_path=tmp_path / "fallback.mp4",
        options=render.RenderOptions(aspect="vertical", captions=False,
                                     normalize_audio=False, face_track=True),
        on_progress=lambda f, m: messages.append(m),
    )
    assert out.exists()
    assert render.probe_dimensions(out) == (OUT_W, OUT_H)
    assert any("no faces here" in m for m in messages)


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
def test_face_track_ignored_for_non_cropping_aspects(panning_video: Path, tmp_path: Path):
    """'original' keeps the whole frame, so there is nothing to track towards."""
    assert not render.crops_to_frame("original")
    assert not render.crops_to_frame("vertical_blur")
    out = render.render_clip(
        source=panning_video, start=0.0, end=2.0,
        out_path=tmp_path / "orig.mp4",
        options=render.RenderOptions(aspect="original", captions=False,
                                     normalize_audio=False, face_track=True),
    )
    assert render.probe_dimensions(out) == (1280, 720)


# --------------------------------------------------------------------------- #
# real Haar detection, when a real photograph is available
# --------------------------------------------------------------------------- #

skimage = pytest.importorskip("skimage", reason="scikit-image not installed")


def test_haar_detects_a_real_face():
    import cv2
    from skimage import data

    photo = cv2.cvtColor(data.astronaut(), cv2.COLOR_RGB2GRAY)
    boxes = tracking.default_detector()(photo)

    assert boxes, "the bundled cascade found no face in a clear frontal photo"
    x, y, w, h = boxes[0]
    height, width = photo.shape[:2]
    cx, cy = (x + w / 2) / width, (y + h / 2) / height
    # The subject's face sits in the upper-left quadrant of this image.
    assert 0.3 < cx < 0.6 and 0.1 < cy < 0.4
    assert 0.1 < w / width < 0.5
