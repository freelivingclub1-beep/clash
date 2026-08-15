import json

import pytest

from treblo.capture import (
    CaptureError,
    RequestTemplate,
    candidate_mode_fields,
    find_lyrics_field,
    find_tags_field,
    parse_curl,
    split_secrets,
)

# Shaped like what Chrome's "Copy as cURL" actually produces.
CURL = r"""curl 'https://treblo.com/api/generate' \
  -H 'accept: application/json' \
  -H 'content-type: application/json' \
  -H 'cookie: session=abc123; refresh=xyz789' \
  -H 'authorization: Bearer tok_live_1234' \
  -H 'user-agent: Mozilla/5.0' \
  --data-raw '{"model":"v3","prompt":{"styles":["yeat","trap","piano"],"lyrics":"MARKER LINE ONE\nsecond bar here","lyricMode":"custom"},"styleStrength":4.5}' \
  --compressed"""


def test_parses_method_url_and_headers():
    req = parse_curl(CURL)
    assert req.method == "POST"
    assert req.url == "https://treblo.com/api/generate"
    assert req.headers["accept"] == "application/json"


def test_parses_body_as_json():
    body = parse_curl(CURL).json_body()
    assert body["model"] == "v3"
    assert body["prompt"]["styles"] == ["yeat", "trap", "piano"]


def test_credentials_are_separated_from_ordinary_headers():
    safe, secret = split_secrets(parse_curl(CURL).headers)
    assert set(secret) == {"cookie", "authorization"}
    assert "user-agent" in safe
    assert "cookie" not in safe


def test_rejects_things_that_arent_curl():
    with pytest.raises(CaptureError, match="doesn't look like"):
        parse_curl("GET /api/generate HTTP/1.1")


def test_finds_the_tag_list_by_matching_known_tags():
    body = parse_curl(CURL).json_body()
    path, fmt = find_tags_field(body, ["yeat", "trap", "piano"])
    assert path == ["prompt", "styles"]
    assert fmt == "list"


def test_finds_comma_joined_tags():
    body = {"opts": {"style": "yeat, trap, piano"}}
    path, fmt = find_tags_field(body, ["yeat", "trap", "piano"])
    assert path == ["opts", "style"]
    assert fmt == "comma"


def test_says_so_when_the_tags_arent_in_the_capture():
    body = parse_curl(CURL).json_body()
    with pytest.raises(CaptureError, match="couldn't find"):
        find_tags_field(body, ["yeat", "jazz", "rock"])


def test_finds_lyrics_by_marker_line():
    body = parse_curl(CURL).json_body()
    assert find_lyrics_field(body, "MARKER LINE ONE") == ["prompt", "lyrics"]


def test_surfaces_lyric_mode_candidates_rather_than_guessing():
    body = parse_curl(CURL).json_body()
    paths = [p for p, _ in candidate_mode_fields(body)]
    assert ["prompt", "lyricMode"] in paths


def test_template_substitutes_new_tags_and_lyrics():
    template = RequestTemplate.from_capture(
        parse_curl(CURL), ["yeat", "trap", "piano"], "MARKER LINE ONE"
    )
    out = template.render(tags=["yeat", "cloud rap", "bass"], lyrics="brand new bar")

    assert out["body"]["prompt"]["styles"] == ["yeat", "cloud rap", "bass"]
    assert out["body"]["prompt"]["lyrics"] == "brand new bar"
    assert out["url"] == "https://treblo.com/api/generate"


def test_render_does_not_mutate_the_stored_template():
    template = RequestTemplate.from_capture(
        parse_curl(CURL), ["yeat", "trap", "piano"], "MARKER LINE ONE"
    )
    template.render(tags=["yeat", "jazz", "rock"], lyrics="x")
    assert template.body["prompt"]["styles"] == ["yeat", "trap", "piano"]


def test_template_survives_a_save_load_round_trip():
    original = RequestTemplate.from_capture(
        parse_curl(CURL), ["yeat", "trap", "piano"], "MARKER LINE ONE"
    )
    restored = RequestTemplate.from_dict(json.loads(json.dumps(original.to_dict())))
    assert restored.render(tags=["yeat", "bass", "drums"], lyrics="y") == original.render(
        tags=["yeat", "bass", "drums"], lyrics="y"
    )


def test_saved_template_carries_no_credentials():
    template = RequestTemplate.from_capture(
        parse_curl(CURL), ["yeat", "trap", "piano"], "MARKER LINE ONE"
    )
    serialized = json.dumps(template.to_dict())
    assert "tok_live_1234" not in serialized
    assert "session=abc123" not in serialized
