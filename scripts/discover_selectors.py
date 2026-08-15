#!/usr/bin/env python3
"""Read the real selectors off treblo.com's Create page.

Run this on your own machine after `python -m treblo.session login`. It opens
the Create page with your saved session, hunts for each control the driver
needs, and writes treblo/selectors.json.

    python scripts/discover_selectors.py            # headless
    python scripts/discover_selectors.py --show     # watch it work

It prints what it found and a snippet of each element's HTML so you can check
it grabbed the right thing before trusting it. Anything it can't find is
reported rather than guessed at -- a wrong selector that silently matches the
wrong element is worse than a missing one.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from treblo.session import DEFAULT_STATE, browser_page  # noqa: E402

OUTPUT = Path(__file__).resolve().parent.parent / "treblo" / "selectors.json"

# What to look for, and how. Each target lists candidate strategies in order
# of preference: placeholder attributes are the most stable, visible text next,
# and we never fall back to positional/nth-child selectors.
TARGETS = [
    {
        "key": "advanced_tab",
        "why": "switches the Create form into Advanced mode",
        "candidates": ['text="Advanced"', 'button:has-text("Advanced")'],
    },
    {
        "key": "tag_input",
        "why": "the Sound box where you type each style tag",
        "candidates": [
            '[placeholder="Search for styles"]',
            'input[placeholder*="styles" i]',
        ],
    },
    {
        "key": "custom_lyrics_radio",
        "why": "selects Custom Lyrics",
        "candidates": ['text="Custom Lyrics"', 'label:has-text("Custom Lyrics")'],
    },
    {
        "key": "auto_lyrics_radio",
        "why": "selects Auto Lyrics (used every Nth generation)",
        "candidates": ['text="Auto Lyrics"', 'label:has-text("Auto Lyrics")'],
    },
    {
        "key": "lyrics_textarea",
        "why": "where the generated bars get pasted",
        "candidates": [
            '[placeholder="Enter custom lyrics"]',
            'textarea[placeholder*="lyrics" i]',
            "textarea",
        ],
    },
    {
        "key": "generate_button",
        "why": "the button that starts a generation",
        "candidates": ['button:has-text("Generate")', 'text="Generate"'],
    },
]


def probe(page, candidates: list[str]) -> dict | None:
    """Return the first candidate that matches exactly one visible element."""
    for selector in candidates:
        try:
            locator = page.locator(selector)
            count = locator.count()
        except Exception:
            continue
        if count == 0:
            continue
        visible = [i for i in range(count) if locator.nth(i).is_visible()]
        if not visible:
            continue
        chosen = locator.nth(visible[0])
        try:
            html = chosen.evaluate("el => el.outerHTML")
        except Exception:
            html = "<unavailable>"
        return {
            "selector": selector,
            "matches": count,
            "visible_matches": len(visible),
            "ambiguous": len(visible) > 1,
            "html": html[:240],
        }
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--show", action="store_true", help="run with a visible browser")
    parser.add_argument("--out", type=Path, default=OUTPUT)
    args = parser.parse_args(argv)

    found: dict[str, str] = {}
    problems: list[str] = []

    with browser_page(args.state, headless=not args.show) as page:
        page.wait_for_timeout(3000)  # let the SPA settle

        # The Advanced tab has to be clicked before the rest of the form exists.
        advanced = probe(page, TARGETS[0]["candidates"])
        if advanced:
            try:
                page.locator(advanced["selector"]).first.click()
                page.wait_for_timeout(1000)
            except Exception as exc:
                problems.append(f"couldn't click Advanced: {exc}")

        for target in TARGETS:
            result = probe(page, target["candidates"])
            print(f"\n{target['key']}  -- {target['why']}")
            if result is None:
                print("  NOT FOUND. Open dev tools and grab it by hand.")
                problems.append(f"{target['key']}: not found")
                continue
            found[target["key"]] = result["selector"]
            flag = "  (AMBIGUOUS -- verify!)" if result["ambiguous"] else ""
            print(f"  selector: {result['selector']}{flag}")
            print(f"  matches:  {result['visible_matches']} visible / {result['matches']} total")
            print(f"  html:     {result['html']}")
            if result["ambiguous"]:
                problems.append(f"{target['key']}: matched more than one visible element")

    args.out.write_text(json.dumps(found, indent=2) + "\n")
    print(f"\nWrote {len(found)}/{len(TARGETS)} selectors to {args.out}")

    if problems:
        print("\nNeeds a human look:")
        for p in problems:
            print(f"  - {p}")
        return 1

    print("\nAll found. Next: implement submit()/poll() in treblo/driver.py.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
