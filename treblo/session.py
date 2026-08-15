"""Authenticated browser session for treblo.com.

Deliberately does NOT handle your password. You log in by hand, once, in a
real browser window; this saves the resulting session state to disk and every
later run reuses it. That means:

  * no password in this repo, in your shell history, or in a chat log
  * no guessing at Treblo's login form, which would break the moment they
    change it
  * captcha / 2FA / "click the email link" all just work, because a human is
    doing the login

    python -m treblo.session login     # once -- browser opens, you log in
    python -m treblo.session check     # confirm the saved session still works

The state file holds live session cookies. Treat it like a password: it is
gitignored, and anyone who copies it is logged into your account.
"""

from __future__ import annotations

import argparse
import sys
from contextlib import contextmanager
from pathlib import Path

BASE_URL = "https://treblo.com"
CREATE_PATH = "/create"
DEFAULT_STATE = Path(".treblo-auth.json")


def _require_playwright():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:  # pragma: no cover - depends on local install
        raise SystemExit(
            "Playwright isn't installed. Run:\n"
            "    pip install playwright\n"
            "    playwright install chromium"
        ) from exc
    return sync_playwright


def login(state_path: Path = DEFAULT_STATE, base_url: str = BASE_URL) -> Path:
    """Open a browser, wait for you to log in, then save the session."""
    sync_playwright = _require_playwright()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(base_url, wait_until="domcontentloaded")

        print(f"A browser window is open at {base_url}.")
        print("Log in there (create the account first if you need to).")
        input("When you're logged in and can see the Create page, press Enter here... ")

        context.storage_state(path=str(state_path))
        browser.close()

    # Session cookies -- lock the file down on platforms that support it.
    try:
        state_path.chmod(0o600)
    except OSError:
        pass
    print(f"Saved session to {state_path}. Keep it private; it is gitignored.")
    return state_path


@contextmanager
def browser_page(
    state_path: Path = DEFAULT_STATE,
    *,
    headless: bool = True,
    base_url: str = BASE_URL,
):
    """Yield a Playwright page already logged in to Treblo."""
    if not Path(state_path).exists():
        raise SystemExit(
            f"No saved session at {state_path}. Run:  python -m treblo.session login"
        )
    sync_playwright = _require_playwright()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(storage_state=str(state_path))
        page = context.new_page()
        page.goto(base_url + CREATE_PATH, wait_until="domcontentloaded")
        try:
            yield page
        finally:
            browser.close()


def check(state_path: Path = DEFAULT_STATE) -> int:
    """Confirm the saved session still gets us to an authenticated page."""
    with browser_page(state_path, headless=True) as page:
        page.wait_for_timeout(2500)
        # The Generate button only renders for a logged-in user, so its
        # presence is a decent liveness check without hardcoding a selector.
        found = page.get_by_text("Generate", exact=False).count()
        title = page.title()
        print(f"page title: {title!r}")
        if found:
            print("Session looks good (found the Generate control).")
            return 0
        print(
            "Couldn't find the Generate control. The session may have expired, "
            "or the page changed. Re-run:  python -m treblo.session login"
        )
        return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="treblo.session")
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("login", help="log in by hand and save the session")
    sub.add_parser("check", help="verify the saved session still works")

    args = parser.parse_args(argv)
    if args.command == "login":
        login(args.state)
        return 0
    return check(args.state)


if __name__ == "__main__":
    sys.exit(main())
