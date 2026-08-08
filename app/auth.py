"""Password gate for public deployments.

A Clash instance on the open internet is a video downloader and a CPU-heavy
encoder that anyone who finds the URL could drive. So when ``CLASH_PASSWORD`` is
set, every request needs a valid session cookie.

The token is an HMAC over its own expiry — no database, no server-side session
store, so it survives the restarts that hosting platforms do routinely.
Leaving ``CLASH_PASSWORD`` unset disables the gate entirely, which is the right
default for running on your own machine.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time

COOKIE = "clash_session"
DEFAULT_TTL_HOURS = 24 * 30  # a phone shouldn't have to log in every day


def password() -> str:
    return os.getenv("CLASH_PASSWORD", "")


def enabled() -> bool:
    return bool(password())


def _secret() -> bytes:
    """Signing key. Explicit if given, otherwise derived from the password.

    Deriving it means tokens stay valid across restarts without asking the
    operator to manage a second secret, and changing the password invalidates
    every existing session — which is what you want when rotating it.
    """
    explicit = os.getenv("CLASH_SECRET", "")
    if explicit:
        return explicit.encode()
    return hashlib.sha256(("clash:" + password()).encode()).digest()


def _sign(payload: str) -> str:
    return hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()


def issue_token(ttl_hours: int = DEFAULT_TTL_HOURS) -> str:
    expiry = str(int(time.time()) + ttl_hours * 3600)
    return f"{expiry}.{_sign(expiry)}"


def verify_token(token: str | None) -> bool:
    if not token or "." not in token:
        return False
    expiry, _, signature = token.partition(".")
    if not hmac.compare_digest(signature, _sign(expiry)):
        return False
    try:
        return int(expiry) > time.time()
    except ValueError:
        return False


def check_password(candidate: str) -> bool:
    """Constant-time comparison, so the check can't be timed character by character."""
    if not enabled():
        return True
    return hmac.compare_digest(candidate or "", password())


def suggest_password() -> str:
    """A sensible password to print when someone deploys without setting one."""
    return secrets.token_urlsafe(12)
