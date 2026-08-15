#!/usr/bin/env python3
"""Turn a 'Copy as cURL' capture into a request template.

How to get the capture (2 minutes, on a desktop browser):

  1. Open treblo.com, log in, go to Create.
  2. Open dev tools (F12) -> Network tab. Tick "Preserve log".
  3. Set tags to exactly: yeat trap piano
     Pick Custom Lyrics and paste a line you'll recognise, e.g.
         MARKER LINE ONE
  4. Press Generate.
  5. In the Network list find the request that fired (usually POST, name like
     generate / create / songs). Right-click -> Copy -> Copy as cURL.
  6. Paste it into a file, then:

     python scripts/from_curl.py capture.txt --tags yeat trap piano \
         --lyrics-snippet "MARKER LINE ONE"

Writes treblo/request.json (safe to commit) and .treblo-secrets.json
(gitignored -- holds your cookies and auth headers).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from treblo.capture import (  # noqa: E402
    CaptureError,
    RequestTemplate,
    candidate_mode_fields,
    get_path,
    parse_curl,
    split_secrets,
)

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_OUT = ROOT / "treblo" / "request.json"
SECRETS_OUT = ROOT / ".treblo-secrets.json"


def show(path) -> str:
    return " -> ".join(str(p) for p in path) if path else "(root)"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("capture", type=Path, help="file holding the copied cURL")
    parser.add_argument("--tags", nargs="+", required=True, help="tags used in the capture")
    parser.add_argument("--lyrics-snippet", default=None, help="a line you pasted as lyrics")
    parser.add_argument("--template-out", type=Path, default=TEMPLATE_OUT)
    parser.add_argument("--secrets-out", type=Path, default=SECRETS_OUT)
    args = parser.parse_args(argv)

    try:
        captured = parse_curl(args.capture.read_text())
    except CaptureError as exc:
        print(f"Couldn't read the capture: {exc}")
        return 1

    print(f"{captured.method} {captured.url}")
    print(f"  {len(captured.headers)} headers, body {len(captured.body or '')} bytes")

    safe, secret = split_secrets(captured.headers)
    print(f"  {len(secret)} credential header(s) split out: {', '.join(secret) or 'none'}")

    try:
        template = RequestTemplate.from_capture(
            captured, args.tags, args.lyrics_snippet
        )
    except CaptureError as exc:
        print(f"\nCouldn't map the payload: {exc}")
        print("\nThe body was:")
        print(json.dumps(captured.json_body(), indent=2)[:2000])
        return 1

    print(f"\nFound tags at:   {show(template.tags_path)}  (as {template.tags_format})")
    if template.lyrics_path is not None:
        print(f"Found lyrics at: {show(template.lyrics_path)}")
    else:
        print("Lyrics field:    not found -- re-capture with --lyrics-snippet")

    body = captured.json_body()
    candidates = candidate_mode_fields(body)
    if candidates:
        print("\nPossible lyric-mode fields (confirm which, then set mode_path):")
        for path, value in candidates[:12]:
            print(f"  {show(path)} = {value!r}")
        print(
            "\n  Guessing this is risky -- a wrong guess silently generates the\n"
            "  wrong kind of song. Capture one Auto Lyrics generation too and\n"
            "  diff the two bodies to see which field actually flipped."
        )

    args.template_out.write_text(json.dumps(template.to_dict(), indent=2) + "\n")
    args.secrets_out.write_text(json.dumps(secret, indent=2) + "\n")
    try:
        args.secrets_out.chmod(0o600)
    except OSError:
        pass

    print(f"\nWrote {args.template_out}")
    print(f"Wrote {args.secrets_out}  (gitignored -- treat like a password)")
    print("\nNext:  python -m treblo.cli run --driver http --generations 3")
    return 0


if __name__ == "__main__":
    sys.exit(main())
