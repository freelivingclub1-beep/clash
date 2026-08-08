"""FastAPI app: paste a URL, get ranked clips, render the ones you want."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import captions as captions_mod
from . import config, jobs, pipeline, render, tracking

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

app = FastAPI(title="Clash", description="Self-hosted viral clip finder", version="1.0")


class AnalyzeRequest(BaseModel):
    url: str
    ranker: str | None = Field(default=None, description="heuristic | llm")
    transcribe: str | None = Field(default=None, description="auto | youtube | whisper")
    max_results: int | None = None
    download: bool = True


class CaptionOptions(BaseModel):
    enabled: bool = True
    style: str = "pop"
    accent: str = "#FFE24B"
    primary: str = "#FFFFFF"
    font: str = config.CAPTION_FONT
    font_size: int = 84
    uppercase: bool = True
    bounce: bool = True
    margin_v: int = 380


class RenderRequest(BaseModel):
    video_id: str
    clip_id: str
    aspect: str = "vertical"
    face_track: bool = False
    captions: CaptionOptions = Field(default_factory=CaptionOptions)
    crf: int = 20
    preset: str = "veryfast"
    normalize_audio: bool = True


def _strip_words(result: dict[str, Any] | None) -> dict[str, Any] | None:
    """The word list is big and the browser never needs it."""
    if not isinstance(result, dict) or "words" not in result:
        return result
    trimmed = dict(result)
    trimmed.pop("words", None)
    return trimmed


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "ffmpeg": config.ffmpeg_available(),
        "whisper": config.whisper_available(),
        "face_tracking": tracking.available(),
        "claude": config.anthropic_available(),
        "default_ranker": config.RANKER,
        "default_transcribe": config.TRANSCRIBE_MODE,
        "min_clip_seconds": config.MIN_CLIP_SECONDS,
        "max_clip_seconds": config.MAX_CLIP_SECONDS,
    }


@app.post("/api/analyze")
def analyze(request: AnalyzeRequest) -> dict[str, Any]:
    if not request.url.strip():
        raise HTTPException(400, "Paste a video URL first.")
    job = jobs.store.submit(
        "analyze",
        pipeline.analyze,
        meta={"url": request.url},
        url=request.url,
        ranker=request.ranker,
        transcribe_mode=request.transcribe,
        max_results=request.max_results,
        download=request.download,
    )
    return job.to_dict()


@app.post("/api/render")
def render_clip(request: RenderRequest) -> dict[str, Any]:
    if not config.ffmpeg_available():
        raise HTTPException(
            503, "ffmpeg was not found on PATH. Install it, then try again."
        )
    try:
        analysis = pipeline.load_analysis(request.video_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc

    options = render.RenderOptions(
        aspect=request.aspect,
        captions=request.captions.enabled,
        crf=request.crf,
        preset=request.preset,
        normalize_audio=request.normalize_audio,
        face_track=request.face_track,
    )
    style = captions_mod.CaptionStyle(
        style=request.captions.style,
        font=request.captions.font,
        font_size=request.captions.font_size,
        primary=request.captions.primary,
        accent=request.captions.accent,
        uppercase=request.captions.uppercase,
        bounce=request.captions.bounce,
        margin_v=request.captions.margin_v,
    )

    render_id = uuid.uuid4().hex[:12]
    out_dir = config.CLIP_DIR / render_id

    def run(on_progress=None):  # type: ignore[no-untyped-def]
        path = pipeline.render_from_analysis(
            analysis=analysis,
            clip_id=request.clip_id,
            options=options,
            style=style,
            out_dir=out_dir,
            on_progress=on_progress,
        )
        return {
            "filename": path.name,
            "url": f"/clips/{render_id}/{path.name}",
            "size_bytes": path.stat().st_size,
        }

    job = jobs.store.submit(
        "render", run, meta={"clip_id": request.clip_id, "render_id": render_id}
    )
    return job.to_dict()


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    job = jobs.store.get(job_id)
    if job is None:
        raise HTTPException(404, "No such job.")
    payload = job.to_dict()
    payload["result"] = _strip_words(payload["result"])
    return payload


@app.get("/api/analysis/{video_id}")
def get_analysis(video_id: str) -> dict[str, Any]:
    try:
        return _strip_words(pipeline.load_analysis(video_id)) or {}
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.exception_handler(ValueError)
def value_error_handler(_request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


config.CLIP_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/clips", StaticFiles(directory=str(config.CLIP_DIR)), name="clips")

if WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
else:  # pragma: no cover - only when the web bundle is missing

    @app.get("/")
    def index() -> FileResponse:
        raise HTTPException(500, "web/ directory is missing.")
