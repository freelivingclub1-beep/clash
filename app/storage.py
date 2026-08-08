"""Keep the data directory from filling the server's disk.

On a laptop, leftover downloads are untidy. On a hosted box they are an outage:
source videos are hundreds of megabytes each, and hosting disks are small. So
rendered clips and cached sources expire on a timer, and a total size cap
evicts the oldest first if traffic outruns the timer.
"""

from __future__ import annotations

import shutil
import threading
import time
from pathlib import Path

from . import config


def _directory_size(path: Path) -> int:
    total = 0
    for item in path.rglob("*"):
        try:
            if item.is_file():
                total += item.stat().st_size
        except OSError:
            continue
    return total


def _entries(root: Path) -> list[tuple[float, Path]]:
    """Immediate children of ``root``, paired with their newest mtime."""
    found: list[tuple[float, Path]] = []
    if not root.exists():
        return found
    for child in root.iterdir():
        try:
            times = [child.stat().st_mtime]
            if child.is_dir():
                times += [f.stat().st_mtime for f in child.rglob("*") if f.is_file()]
            found.append((max(times), child))
        except OSError:
            continue
    return found


def _remove(path: Path) -> None:
    try:
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)
    except OSError:
        pass


def reap(now: float | None = None) -> dict[str, int]:
    """Delete expired clips and sources, then enforce the disk cap.

    Returns counts so the caller can log what happened.
    """
    now = now if now is not None else time.time()
    removed = {"clips": 0, "sources": 0, "evicted": 0}

    for root, ttl_hours, key in (
        (config.CLIP_DIR, config.CLIP_TTL_HOURS, "clips"),
        (config.SOURCE_DIR, config.SOURCE_TTL_HOURS, "sources"),
    ):
        if ttl_hours <= 0:
            continue
        cutoff = now - ttl_hours * 3600
        for mtime, path in _entries(root):
            if mtime < cutoff:
                _remove(path)
                removed[key] += 1

    cap = config.MAX_DISK_BYTES
    if cap > 0:
        used = _directory_size(config.DATA_DIR)
        if used > cap:
            # Oldest first: a clip the user just rendered is the one they want kept.
            candidates = _entries(config.SOURCE_DIR) + _entries(config.CLIP_DIR)
            for _mtime, path in sorted(candidates):
                if used <= cap:
                    break
                used -= _directory_size(path) if path.is_dir() else path.stat().st_size
                _remove(path)
                removed["evicted"] += 1

    return removed


def start_reaper(interval_seconds: int = 1800) -> threading.Thread:
    """Run :func:`reap` on a loop in the background."""

    def loop() -> None:
        while True:
            try:
                reap()
            except Exception:  # a cleanup failure must never take the app down
                pass
            time.sleep(interval_seconds)

    thread = threading.Thread(target=loop, name="clash-reaper", daemon=True)
    thread.start()
    return thread


def usage() -> dict[str, float]:
    used = _directory_size(config.DATA_DIR)
    return {
        "used_bytes": used,
        "used_gb": round(used / 1e9, 2),
        "cap_gb": round(config.MAX_DISK_BYTES / 1e9, 2) if config.MAX_DISK_BYTES else 0,
    }
