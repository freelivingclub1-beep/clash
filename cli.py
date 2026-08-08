#!/usr/bin/env python3
"""Command-line front end.

    python cli.py analyze "https://youtu.be/..."
    python cli.py clip    "https://youtu.be/..." --top 3 --aspect vertical
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app import captions as captions_mod
from app import config, pipeline, render


def _bar(fraction: float, message: str) -> None:
    width = 28
    filled = int(fraction * width)
    sys.stderr.write(f"\r[{'#' * filled}{'.' * (width - filled)}] {message[:44]:<44}")
    sys.stderr.flush()
    if fraction >= 1.0:
        sys.stderr.write("\n")


def _timestamp(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def _print_clips(result: dict, limit: int | None = None) -> None:
    clips = result["clips"][:limit] if limit else result["clips"]
    print(f"\n{result['source']['title']}")
    print(
        f"  transcript: {result['transcript_source']}  "
        f"ranker: {result['ranker']}  "
        f"words: {result['word_count']}  "
        f"candidates scanned: {result['candidates_considered']}\n"
    )
    for n, clip in enumerate(clips, 1):
        print(f"{n:>2}. [{clip['score']:>5.1f}]  {_timestamp(clip['start'])}"
              f"-{_timestamp(clip['end'])}  ({int(clip['duration'])}s)")
        print(f"     {clip['title']}")
        print(f"     {clip['reason']}")
        snippet = clip["text"][:180].replace("\n", " ")
        print(f"     \"{snippet}{'…' if len(clip['text']) > 180 else ''}\"\n")


def cmd_analyze(args: argparse.Namespace) -> int:
    result = pipeline.analyze(
        args.url,
        ranker=args.ranker,
        transcribe_mode=args.transcribe,
        max_results=args.top,
        on_progress=_bar,
    )
    _print_clips(result)
    print(f"Cached analysis: {pipeline.analysis_path(result['source']['video_id'])}")
    return 0


def cmd_clip(args: argparse.Namespace) -> int:
    if not config.ffmpeg_available():
        print("ffmpeg not found on PATH — install it before rendering.", file=sys.stderr)
        return 2

    result = pipeline.analyze(
        args.url,
        ranker=args.ranker,
        transcribe_mode=args.transcribe,
        max_results=max(args.top, config.MAX_RESULTS),
        on_progress=_bar,
    )
    _print_clips(result, limit=args.top)

    options = render.RenderOptions(
        aspect=args.aspect,
        captions=not args.no_captions,
        crf=args.crf,
        preset=args.preset,
        face_track=args.face_track,
    )
    style = captions_mod.CaptionStyle(
        style=args.caption_style,
        accent=args.accent,
        font=args.font,
        uppercase=not args.no_uppercase,
    )

    out_root = Path(args.out or (config.CLIP_DIR / result["source"]["video_id"]))
    for clip in result["clips"][: args.top]:
        print(f"\nRendering {clip['id']} — {clip['title']}")
        path = pipeline.render_from_analysis(
            analysis=result,
            clip_id=clip["id"],
            options=options,
            style=style,
            out_dir=out_root,
            on_progress=_bar,
        )
        print(f"  -> {path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="clash", description="Auto-clip long videos.")
    sub = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("url", help="Video URL (YouTube and anything else yt-dlp supports)")
    common.add_argument("--ranker", choices=["heuristic", "llm"], default=None)
    common.add_argument("--transcribe", choices=["auto", "youtube", "whisper"], default=None)
    common.add_argument("--top", type=int, default=config.MAX_RESULTS)

    p_analyze = sub.add_parser("analyze", parents=[common], help="List clips without rendering")
    p_analyze.set_defaults(func=cmd_analyze)

    p_clip = sub.add_parser("clip", parents=[common], help="Find and render clips")
    p_clip.add_argument(
        "--aspect", choices=["vertical", "vertical_blur", "square", "original"], default="vertical"
    )
    p_clip.add_argument("--caption-style", choices=["pop", "single"], default="pop")
    p_clip.add_argument("--accent", default="#FFE24B", help="Highlight colour, #RRGGBB")
    p_clip.add_argument("--font", default=config.CAPTION_FONT)
    p_clip.add_argument(
        "--face-track", action="store_true",
        help="Follow the speaker instead of cropping to the centre",
    )
    p_clip.add_argument("--no-captions", action="store_true")
    p_clip.add_argument("--no-uppercase", action="store_true")
    p_clip.add_argument("--crf", type=int, default=20)
    p_clip.add_argument("--preset", default="veryfast")
    p_clip.add_argument("--out", default=None, help="Output directory")
    p_clip.set_defaults(func=cmd_clip)

    args = parser.parse_args()
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"\nError: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
