"""End-to-end: URL in, ranked clip candidates out, then render on demand."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Callable

from . import captions as captions_mod
from . import config, ingest, llm, render, score, segment, transcribe
from .models import Candidate, SourceVideo, Transcript, Word

Progress = Callable[[float, str], None]

# The heuristic pass hands this many candidates to Claude. Enough for a good
# selection, small enough that a long video still costs cents.
LLM_SHORTLIST = 24


def _noop(_fraction: float, _message: str) -> None:
    return None


def analysis_path(video_id: str) -> Path:
    return config.CACHE_DIR / video_id / "analysis.json"


def analyze(
    url: str,
    ranker: str | None = None,
    transcribe_mode: str | None = None,
    max_results: int | None = None,
    download: bool = True,
    on_progress: Progress | None = None,
) -> dict:
    """Fetch, transcribe, segment and rank. Returns a serialisable result."""
    report = on_progress or _noop
    ranker = ranker or config.RANKER
    max_results = max_results or config.MAX_RESULTS

    report(0.02, "Reading video details")
    url = ingest.normalize_url(url)
    source = ingest.probe(url)

    ceiling = config.MAX_SOURCE_MINUTES * 60
    if ceiling and source.duration > ceiling:
        raise RuntimeError(
            f"That video is {source.duration / 60:.0f} minutes long; this instance "
            f"accepts up to {config.MAX_SOURCE_MINUTES}. Raise CLASH_MAX_SOURCE_MINUTES "
            "to allow longer ones."
        )

    report(0.08, "Checking for a caption track")
    caption_path = None
    if (transcribe_mode or config.TRANSCRIBE_MODE) in {"auto", "youtube"}:
        caption_path = ingest.fetch_captions(url, source.video_id)

    media_path: Path | None = None
    needs_media = download or caption_path is None
    if needs_media:
        report(0.12, "Downloading video")
        media_path = ingest.download_media(
            url,
            source.video_id,
            lambda f, m: report(0.12 + f * 0.33, m),
        )
        source.path = str(media_path)

    report(0.48, "Transcribing")
    transcript = transcribe.transcribe(media_path, caption_path, transcribe_mode)

    report(0.66, "Finding self-contained moments")
    units = segment.build_units(transcript)
    if not units:
        raise RuntimeError("No speech was found in this video.")

    spans = segment.enumerate_candidates(units)
    if not spans:
        raise RuntimeError(
            f"This video has no stretch of speech between "
            f"{int(config.MIN_CLIP_SECONDS)}s and {int(config.MAX_CLIP_SECONDS)}s."
        )

    report(0.72, f"Scoring {len(spans)} candidate clips")
    scored: list[Candidate] = []
    for index, (i, j) in enumerate(spans):
        candidate = segment.span_to_candidate(units, i, j, index)
        scored.append(score.score_candidate(candidate, units, i, j))

    used_ranker = "heuristic"
    shortlist = segment.suppress_overlaps(scored, max_results)

    if ranker == "llm" and config.anthropic_available():
        report(0.82, "Asking Claude which clips would actually travel")
        wide = segment.suppress_overlaps(scored, LLM_SHORTLIST)
        try:
            reranked = llm.rerank(wide, video_title=source.title)
            shortlist = segment.suppress_overlaps(reranked, max_results)
            used_ranker = "claude"
        except Exception as exc:  # ranking is a refinement, never a hard failure
            report(0.85, f"Claude ranking unavailable ({exc}); keeping heuristic order")
    elif ranker == "llm":
        report(0.82, "No ANTHROPIC_API_KEY set — using the free heuristic ranker")

    shortlist.sort(key=lambda c: c.score, reverse=True)

    result = {
        "source": asdict(source),
        "transcript_source": transcript.source,
        "ranker": used_ranker,
        "word_count": len(transcript.words),
        "candidates_considered": len(spans),
        "clips": [c.to_dict() for c in shortlist],
        "words": [asdict(w) for w in transcript.words],
    }

    path = analysis_path(source.video_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result), encoding="utf-8")

    report(1.0, "Done")
    return result


def load_analysis(video_id: str) -> dict:
    path = analysis_path(video_id)
    if not path.exists():
        raise FileNotFoundError(f"No analysis cached for {video_id}. Analyze the video first.")
    return json.loads(path.read_text(encoding="utf-8"))


def render_from_analysis(
    analysis: dict,
    clip_id: str,
    options: render.RenderOptions,
    style: captions_mod.CaptionStyle,
    out_dir: Path,
    on_progress: Progress | None = None,
) -> Path:
    report = on_progress or _noop
    clip = next((c for c in analysis["clips"] if c["id"] == clip_id), None)
    if clip is None:
        raise ValueError(f"Unknown clip id {clip_id!r}.")

    source = analysis["source"]
    media_path = source.get("path")
    if not media_path or not Path(media_path).exists():
        report(0.05, "Fetching the source video")
        media_path = str(
            ingest.download_media(source["url"], source["video_id"], lambda f, m: report(f * 0.4, m))
        )
        source["path"] = media_path
        analysis_path(source["video_id"]).write_text(json.dumps(analysis), encoding="utf-8")

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    ass_path = None
    if options.captions:
        report(0.45, "Building captions")
        words = [Word(**w) for w in analysis["words"]]
        src_w, src_h = render.probe_dimensions(Path(media_path))
        out_w, out_h = render.output_size(src_w, src_h, options)
        ass_path = captions_mod.build_ass(
            words,
            clip_start=clip["start"],
            clip_end=clip["end"],
            out_path=out_dir / "captions.ass",
            style=style,
            width=out_w,
            height=out_h,
        )

    out_path = out_dir / f"{source['video_id']}_{clip_id}.mp4"
    report(0.5, "Rendering")
    render.render_clip(
        source=Path(media_path),
        start=clip["start"],
        end=clip["end"],
        out_path=out_path,
        options=options,
        ass_path=ass_path,
        on_progress=lambda f, m: report(0.5 + f * 0.5, m),
    )
    report(1.0, "Done")
    return out_path
