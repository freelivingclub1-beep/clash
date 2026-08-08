"""A tiny in-process job registry so the browser can poll long-running work."""

from __future__ import annotations

import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

_MAX_WORKERS = 2  # ffmpeg and whisper are both CPU-hungry; don't oversubscribe


@dataclass
class Job:
    id: str
    kind: str
    status: str = "queued"  # queued | running | done | error
    progress: float = 0.0
    message: str = "Queued"
    result: Any = None
    error: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "progress": round(self.progress, 3),
            "message": self.message,
            "result": self.result,
            "error": self.error,
            "meta": self.meta,
        }


class JobStore:
    def __init__(self, max_workers: int = _MAX_WORKERS) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="clash")

    def submit(
        self,
        kind: str,
        fn: Callable[..., Any],
        meta: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], kind=kind, meta=meta or {})
        with self._lock:
            self._jobs[job.id] = job

        def report(fraction: float, message: str) -> None:
            with self._lock:
                job.progress = max(0.0, min(1.0, float(fraction)))
                job.message = message

        def run() -> None:
            with self._lock:
                job.status = "running"
                job.message = "Starting"
            try:
                result = fn(on_progress=report, **kwargs)
                with self._lock:
                    job.result = result
                    job.status = "done"
                    job.progress = 1.0
                    job.message = "Done"
            except Exception as exc:
                traceback.print_exc()
                with self._lock:
                    job.status = "error"
                    job.error = str(exc) or exc.__class__.__name__
                    job.message = "Failed"

        self._pool.submit(run)
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def all(self) -> list[Job]:
        with self._lock:
            return list(self._jobs.values())


store = JobStore()
