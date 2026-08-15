"""Driver that talks to Treblo's own backend, using a captured request.

This is the good path. Browser automation drives a whole Chromium instance to
click a button; this sends the same HTTP request the button sends. It's an
order of magnitude lighter, doesn't break when the page layout shifts, and
runs anywhere -- a Pi, a cheap VPS, a spare laptop.

It needs two files, both produced by scripts/from_curl.py:

    treblo/request.json     the request shape (safe to commit)
    .treblo-secrets.json    your cookies / auth headers (gitignored)

Stdlib only, so there's nothing to install on the box that runs it.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

from .capture import RequestTemplate
from .driver import GenerationSpec, JobState, JobStatus, RenderedSong, TrebloDriver

DEFAULT_TEMPLATE = Path(__file__).with_name("request.json")
DEFAULT_SECRETS = Path(__file__).resolve().parent.parent / ".treblo-secrets.json"

# Response fields Treblo might use for each concept. Checked in order.
JOB_ID_KEYS = ("id", "job_id", "jobId", "generation_id", "generationId", "task_id", "uuid")
STATE_KEYS = ("status", "state", "phase")
DONE_STATES = {"complete", "completed", "done", "succeeded", "success", "finished", "ready"}
FAILED_STATES = {"failed", "error", "errored", "cancelled", "canceled"}
PENDING_STATES = {"queued", "pending", "waiting", "submitted"}


class SessionExpired(RuntimeError):
    """Treblo stopped accepting our credentials.

    Session cookies don't last forever, so an unattended run will eventually
    hit this. Raised loudly rather than retried, because no amount of retrying
    fixes it -- it needs a fresh capture.
    """

    def __init__(self, status: int) -> None:
        super().__init__(
            f"Treblo rejected our credentials (HTTP {status}). The saved session "
            "has expired.\nRe-capture it in dev tools, then replace "
            ".treblo-secrets.json and restart:\n"
            "    python scripts/from_curl.py capture.txt --tags yeat trap piano"
        )
        self.status = status


class HttpDriver(TrebloDriver):
    def __init__(
        self,
        template: RequestTemplate | None = None,
        secrets: dict[str, str] | None = None,
        *,
        template_path: Path = DEFAULT_TEMPLATE,
        secrets_path: Path = DEFAULT_SECRETS,
        status_url: str | None = None,
        timeout: float = 30.0,
        opener: Callable[[urllib.request.Request, float], bytes] | None = None,
    ) -> None:
        self.template = template or self._load_template(template_path)
        self.secrets = secrets if secrets is not None else self._load_secrets(secrets_path)
        self.status_url = status_url
        self.timeout = timeout
        self._open = opener or self._urlopen

    @staticmethod
    def _load_template(path: Path) -> RequestTemplate:
        if not path.exists():
            raise FileNotFoundError(
                f"No captured request at {path}. Capture one with dev tools, then:\n"
                "    python scripts/from_curl.py capture.txt --tags yeat trap piano"
            )
        return RequestTemplate.from_dict(json.loads(path.read_text()))

    @staticmethod
    def _load_secrets(path: Path) -> dict[str, str]:
        if not path.exists():
            raise FileNotFoundError(
                f"No credentials at {path}. scripts/from_curl.py writes this "
                "from your captured request."
            )
        return json.loads(path.read_text())

    @staticmethod
    def _urlopen(request: urllib.request.Request, timeout: float) -> bytes:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()

    # -- TrebloDriver -----------------------------------------------------

    def submit(self, spec: GenerationSpec) -> str:
        rendered = self.template.render(
            tags=spec.tags, lyrics=spec.lyrics, mode=spec.lyric_mode
        )
        payload = self._send(
            rendered["method"], rendered["url"], rendered["headers"], rendered["body"]
        )
        job_id = _first_key(payload, JOB_ID_KEYS)
        if job_id is None:
            raise RuntimeError(
                "Couldn't find a job id in Treblo's response. Add the right key "
                f"to JOB_ID_KEYS. Response was: {json.dumps(payload)[:400]}"
            )
        return str(job_id)

    def poll(self, job_id: str) -> JobStatus:
        if not self.status_url:
            raise RuntimeError(
                "HttpDriver needs status_url to poll. Capture the request the "
                "page makes while a song is rendering (dev tools -> Network, "
                "watch what repeats), and pass it with {job_id} in the path."
            )
        url = self.status_url.format(job_id=job_id)
        try:
            payload = self._send("GET", url, self.template.headers, None)
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                retry = exc.headers.get("Retry-After")
                return JobStatus(
                    job_id,
                    JobState.QUEUED,
                    retry_after=float(retry) if retry else 60.0,
                )
            return JobStatus(job_id, JobState.FAILED, error=f"HTTP {exc.code}")

        return self._interpret(job_id, payload)

    # -- internals --------------------------------------------------------

    def _send(self, method: str, url: str, headers: dict, body: Any) -> Any:
        data = None
        merged = {**headers, **self.secrets}
        if body is not None:
            data = json.dumps(body).encode()
            merged.setdefault("content-type", "application/json")

        request = urllib.request.Request(url, data=data, method=method)
        for name, value in merged.items():
            request.add_header(name, value)

        try:
            raw = self._open(request, self.timeout)
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise SessionExpired(exc.code) from None
            raise
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"raw": raw.decode(errors="replace")}

    def _interpret(self, job_id: str, payload: Any) -> JobStatus:
        state_value = _first_key(payload, STATE_KEYS)
        state_text = str(state_value).lower() if state_value is not None else ""

        songs = [
            RenderedSong(
                external_id=str(_first_key(entry, JOB_ID_KEYS) or ""),
                title=entry.get("title") if isinstance(entry, dict) else None,
                url=_first_key(entry, ("url", "audio_url", "audioUrl", "song_url")),
            )
            for entry in _find_song_entries(payload)
        ]

        if state_text in DONE_STATES or (songs and all(s.url for s in songs)):
            return JobStatus(job_id, JobState.DONE, songs=songs)
        if state_text in FAILED_STATES:
            error = _first_key(payload, ("error", "message", "detail"))
            return JobStatus(job_id, JobState.FAILED, error=str(error) if error else state_text)
        if state_text in PENDING_STATES:
            return JobStatus(job_id, JobState.QUEUED)
        return JobStatus(job_id, JobState.RENDERING)


def _first_key(obj: Any, keys: tuple[str, ...]):
    if not isinstance(obj, dict):
        return None
    for key in keys:
        if key in obj and obj[key] is not None:
            return obj[key]
    # One level down, for responses shaped like {"data": {...}}.
    for value in obj.values():
        if isinstance(value, dict):
            for key in keys:
                if key in value and value[key] is not None:
                    return value[key]
    return None


def _find_song_entries(payload: Any) -> list[dict]:
    """Pull out per-song objects from whatever shape the response uses."""
    if isinstance(payload, list):
        return [e for e in payload if isinstance(e, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("songs", "clips", "tracks", "results", "data", "items"):
        value = payload.get(key)
        if isinstance(value, list):
            return [e for e in value if isinstance(e, dict)]
    return [payload] if _first_key(payload, ("url", "audio_url", "audioUrl")) else []
