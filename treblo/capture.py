"""Turn a captured browser request into a reusable request template.

Treblo has no published API, but its web app obviously calls one. Open dev
tools, press Generate once, and copy that request as cURL -- that *is* the
API, documented or not.

This parses the copied cURL and works out where in the payload the tags and
lyrics live, by searching for values you already know you typed. So you don't
have to reverse-engineer their JSON by hand: generate once with tags
`yeat trap piano`, tell this script those tags, and it finds them.

    python scripts/from_curl.py capture.txt --tags yeat trap piano

Auth headers and cookies are split out into a separate gitignored file, so the
template itself is safe to commit and share.
"""

from __future__ import annotations

import json
import re
import shlex
from dataclasses import dataclass, field
from typing import Any

# Headers that carry credentials. Kept out of the committed template.
SECRET_HEADERS = {
    "cookie",
    "authorization",
    "x-api-key",
    "x-auth-token",
    "x-session-token",
    "x-csrf-token",
    "x-xsrf-token",
}

# Headers the HTTP client sets itself, or that break replay if copied.
DROP_HEADERS = {"content-length", "host", "connection", "accept-encoding"}

PLACEHOLDER_TAGS = "__TREBLO_TAGS__"
PLACEHOLDER_LYRICS = "__TREBLO_LYRICS__"


class CaptureError(ValueError):
    pass


@dataclass
class CapturedRequest:
    method: str
    url: str
    headers: dict[str, str]
    body: str | None

    def json_body(self) -> Any:
        if not self.body:
            raise CaptureError("captured request has no body")
        try:
            return json.loads(self.body)
        except json.JSONDecodeError as exc:
            raise CaptureError(
                "request body isn't JSON. If Treblo posts form data or "
                "multipart, the template needs handling for that instead."
            ) from exc


def parse_curl(text: str) -> CapturedRequest:
    """Parse a 'Copy as cURL' command from Chrome/Firefox dev tools."""
    text = text.strip()
    if not text.startswith("curl"):
        raise CaptureError("that doesn't look like a cURL command")

    # Dev tools wrap long commands with trailing backslashes.
    text = re.sub(r"\\\r?\n", " ", text)
    try:
        tokens = shlex.split(text)
    except ValueError as exc:
        raise CaptureError(f"couldn't parse the command: {exc}") from exc

    url = None
    method = None
    headers: dict[str, str] = {}
    body = None

    i = 1
    while i < len(tokens):
        token = tokens[i]
        if token in ("-H", "--header"):
            i += 1
            name, _, value = tokens[i].partition(":")
            headers[name.strip().lower()] = value.strip()
        elif token in ("-X", "--request"):
            i += 1
            method = tokens[i].upper()
        elif token in ("-b", "--cookie"):
            i += 1
            headers["cookie"] = tokens[i]
        elif token in ("-d", "--data", "--data-raw", "--data-binary", "--data-ascii"):
            i += 1
            body = tokens[i]
        elif token.startswith("-"):
            # Flags we don't care about (--compressed, -s, --insecure, ...).
            pass
        elif url is None:
            url = token
        i += 1

    if url is None:
        raise CaptureError("no URL found in the cURL command")

    headers = {k: v for k, v in headers.items() if k not in DROP_HEADERS}
    return CapturedRequest(
        method=method or ("POST" if body else "GET"),
        url=url,
        headers=headers,
        body=body,
    )


def split_secrets(headers: dict[str, str]) -> tuple[dict[str, str], dict[str, str]]:
    """Separate credential headers from ordinary ones."""
    safe, secret = {}, {}
    for name, value in headers.items():
        (secret if name in SECRET_HEADERS else safe)[name] = value
    return safe, secret


# --------------------------------------------------------------------------
# Locating the fields we need to vary
# --------------------------------------------------------------------------

Path = list[str | int]


def walk(obj: Any, path: Path | None = None):
    """Yield (path, value) for every node in a nested JSON structure."""
    path = path or []
    yield path, obj
    if isinstance(obj, dict):
        for key, value in obj.items():
            yield from walk(value, path + [key])
    elif isinstance(obj, list):
        for index, value in enumerate(obj):
            yield from walk(value, path + [index])


def get_path(obj: Any, path: Path) -> Any:
    for step in path:
        obj = obj[step]
    return obj


def set_path(obj: Any, path: Path, value: Any) -> None:
    if not path:
        raise CaptureError("cannot replace the whole body")
    for step in path[:-1]:
        obj = obj[step]
    obj[path[-1]] = value


def find_tags_field(body: Any, tags: list[str]) -> tuple[Path, str]:
    """Find where the tag list lives, and how it's encoded.

    Returns (path, format) where format is "list", "comma" or "space".
    """
    wanted = [t.lower() for t in tags]
    wanted_set = set(wanted)

    for path, value in walk(body):
        if isinstance(value, list) and value and all(isinstance(v, str) for v in value):
            if {v.lower() for v in value} == wanted_set:
                return path, "list"

    for path, value in walk(body):
        if not isinstance(value, str):
            continue
        lowered = value.lower()
        if "," in value and {p.strip() for p in lowered.split(",")} == wanted_set:
            return path, "comma"
        if {p.strip() for p in lowered.split()} == wanted_set:
            return path, "space"

    raise CaptureError(
        f"couldn't find {tags} anywhere in the request body. Make sure you "
        "captured a generation that used exactly those tags."
    )


def find_lyrics_field(body: Any, lyrics_snippet: str | None) -> Path | None:
    """Find the custom-lyrics field, by matching text you know you pasted."""
    if lyrics_snippet:
        needle = lyrics_snippet.strip().lower()
        for path, value in walk(body):
            if isinstance(value, str) and needle in value.lower():
                return path
        raise CaptureError(
            "couldn't find that lyrics snippet in the body. Pass the first "
            "line of the lyrics you actually pasted into Treblo."
        )

    # No snippet given: fall back to the longest multi-line string.
    best: tuple[int, Path] | None = None
    for path, value in walk(body):
        if isinstance(value, str) and "\n" in value:
            if best is None or len(value) > best[0]:
                best = (len(value), path)
    return best[1] if best else None


def candidate_mode_fields(body: Any) -> list[tuple[Path, Any]]:
    """Fields that plausibly encode Custom vs Auto vs No lyrics.

    Not auto-applied -- guessing this wrong silently generates the wrong kind
    of song, so it's surfaced for a human to confirm.
    """
    out = []
    for path, value in walk(body):
        if isinstance(value, bool):
            out.append((path, value))
        elif isinstance(value, str) and value.lower() in {
            "custom", "auto", "none", "custom_lyrics", "auto_lyrics", "no_lyrics",
            "instrumental",
        }:
            out.append((path, value))
    return out


@dataclass
class RequestTemplate:
    """A captured request with the varying fields turned into placeholders."""

    method: str
    url: str
    headers: dict[str, str]
    body: Any
    tags_path: Path
    tags_format: str
    lyrics_path: Path | None = None
    mode_path: Path | None = None
    mode_values: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_capture(
        cls,
        captured: CapturedRequest,
        tags: list[str],
        lyrics_snippet: str | None = None,
    ) -> "RequestTemplate":
        body = captured.json_body()
        tags_path, tags_format = find_tags_field(body, tags)
        lyrics_path = find_lyrics_field(body, lyrics_snippet)
        safe_headers, _ = split_secrets(captured.headers)
        return cls(
            method=captured.method,
            url=captured.url,
            headers=safe_headers,
            body=body,
            tags_path=tags_path,
            tags_format=tags_format,
            lyrics_path=lyrics_path,
        )

    def render(
        self,
        tags: list[str],
        lyrics: str | None = None,
        mode: str | None = None,
    ) -> dict:
        """Produce a concrete request body for one generation."""
        body = json.loads(json.dumps(self.body))  # deep copy

        if self.tags_format == "list":
            set_path(body, self.tags_path, list(tags))
        elif self.tags_format == "comma":
            set_path(body, self.tags_path, ", ".join(tags))
        else:
            set_path(body, self.tags_path, " ".join(tags))

        if self.lyrics_path is not None:
            set_path(body, self.lyrics_path, lyrics or "")

        if mode and self.mode_path is not None and mode in self.mode_values:
            set_path(body, self.mode_path, self.mode_values[mode])

        return {
            "method": self.method,
            "url": self.url,
            "headers": dict(self.headers),
            "body": body,
        }

    def to_dict(self) -> dict:
        return {
            "method": self.method,
            "url": self.url,
            "headers": self.headers,
            "body": self.body,
            "tags_path": self.tags_path,
            "tags_format": self.tags_format,
            "lyrics_path": self.lyrics_path,
            "mode_path": self.mode_path,
            "mode_values": self.mode_values,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "RequestTemplate":
        return cls(
            method=data["method"],
            url=data["url"],
            headers=data["headers"],
            body=data["body"],
            tags_path=data["tags_path"],
            tags_format=data["tags_format"],
            lyrics_path=data.get("lyrics_path"),
            mode_path=data.get("mode_path"),
            mode_values=data.get("mode_values", {}),
        )
