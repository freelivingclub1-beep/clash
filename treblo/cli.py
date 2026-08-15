"""Command line front end.

    python -m treblo.cli tags yeat trap piano
    python -m treblo.cli run --generations 12
    python -m treblo.cli status
    python -m treblo.cli songs

`run` uses the offline simulator unless a real driver is wired up, because
Treblo has no public API yet -- see treblo/driver.py.
"""

from __future__ import annotations

import argparse
import json
import time

from .driver import FakeDriver
from .library import Library
from .lyrics import Deduplicator, LyricWriter, TemplateSource
from .quota import Quota
from .runner import Runner, RunnerConfig
from .tags import TagError, TagSet


def build_driver(args, clock):
    if args.driver == "fake":
        return FakeDriver(clock, seed=args.seed)
    if args.driver == "http":
        from .http_driver import HttpDriver

        try:
            return HttpDriver(status_url=args.status_url)
        except FileNotFoundError as exc:
            raise SystemExit(str(exc)) from None
    if args.driver == "browser":
        raise SystemExit(
            "The browser driver needs submit()/poll() implemented first. "
            "Prefer --driver http: capture the request with dev tools and run "
            "scripts/from_curl.py."
        )
    raise SystemExit(f"unknown driver: {args.driver}")


def build_runner(args) -> tuple[Runner, Library]:
    library = Library(args.db)
    clock = time.time
    driver = build_driver(args, clock)
    writer = LyricWriter(TemplateSource(), Deduplicator(library))
    runner = Runner(
        driver=driver,
        library=library,
        writer=writer,
        quota=Quota(clock=clock, burst=args.burst),
        tag_set=TagSet(args.tags),
        rotation_pool=args.rotate,
        config=RunnerConfig(bars_per_song=args.bars),
        clock=clock,
    )
    return runner, library


def cmd_tags(args) -> int:
    try:
        print(" ".join(TagSet(args.tags).tags))
        return 0
    except TagError as exc:
        print(str(exc))
        return 1


def cmd_run(args) -> int:
    runner, library = build_runner(args)
    try:
        while args.generations is None or runner.generation_count < args.generations:
            result = runner.tick()
            started = result["started"]
            if started:
                print(
                    f"gen {runner.generation_count}: {started['job_id']} "
                    f"[{','.join(started['tags'])}] {started['lyric_mode']}"
                    + (f" ({started['bars']} bars)" if started["bars"] else "")
                )
            for job_id in result["finished"]:
                print(f"  done: {job_id}")
            if not started and not result["finished"]:
                wait = runner.wait_hint()
                print(
                    f"  waiting {wait:.0f}s "
                    f"(next slot ~{runner.quota.seconds_until_available():.0f}s)"
                )
                time.sleep(wait)
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        print(json.dumps(runner.status(), indent=2))
        library.close()
    return 0


def cmd_status(args) -> int:
    library = Library(args.db)
    print(
        json.dumps(
            {
                "songs": library.song_count(),
                "bars_in_corpus": library.line_count(),
                "by_status": {
                    s: len(library.songs(status=s, limit=10_000))
                    for s in ("queued", "done", "failed")
                },
            },
            indent=2,
        )
    )
    library.close()
    return 0


def cmd_songs(args) -> int:
    library = Library(args.db)
    for song in library.songs(limit=args.limit):
        print(
            f"#{song.id:<5} {song.status:<8} [{','.join(song.tags)}] "
            f"{song.lyric_mode:<7} {song.treblo_url or ''}"
        )
    library.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="treblo")
    parser.add_argument("--db", default="treblo.db")
    sub = parser.add_subparsers(dest="command", required=True)

    p_tags = sub.add_parser("tags", help="validate a tag list")
    p_tags.add_argument("tags", nargs="+")
    p_tags.set_defaults(func=cmd_tags)

    p_run = sub.add_parser("run", help="run the generation loop")
    p_run.add_argument("--tags", nargs="+", default=["yeat", "trap", "piano"])
    p_run.add_argument("--rotate", nargs="*", default=["guitar", "bass", "cloud rap", "sampling"])
    p_run.add_argument("--generations", type=int, default=None)
    p_run.add_argument("--bars", type=int, default=16)
    p_run.add_argument("--burst", type=int, default=3)
    p_run.add_argument("--seed", type=int, default=0)
    p_run.add_argument(
        "--driver",
        choices=["fake", "http", "browser"],
        default="fake",
        help="fake = offline simulator; http = replay a captured request",
    )
    p_run.add_argument(
        "--status-url",
        default=None,
        help="polling endpoint for --driver http, with {job_id} in it",
    )
    p_run.set_defaults(func=cmd_run)

    p_status = sub.add_parser("status", help="library summary")
    p_status.set_defaults(func=cmd_status)

    p_songs = sub.add_parser("songs", help="list recent songs")
    p_songs.add_argument("--limit", type=int, default=20)
    p_songs.set_defaults(func=cmd_songs)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
