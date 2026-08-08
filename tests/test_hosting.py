"""Everything that only matters once the app is reachable from the internet:
the password gate, disk housekeeping, and the source-length ceiling.
"""

from __future__ import annotations

import importlib
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import auth  # noqa: E402

PASSWORD = "correct-horse-battery-staple"


@pytest.fixture
def secured(monkeypatch):
    """An app instance with the password gate switched on."""
    monkeypatch.setenv("CLASH_PASSWORD", PASSWORD)
    from app import main

    importlib.reload(main)
    with TestClient(main.app) as client:
        yield client


@pytest.fixture
def open_instance(monkeypatch):
    monkeypatch.delenv("CLASH_PASSWORD", raising=False)
    from app import main

    importlib.reload(main)
    with TestClient(main.app) as client:
        yield client


# --------------------------------------------------------------------------- #
# tokens
# --------------------------------------------------------------------------- #

def test_token_roundtrip(monkeypatch):
    monkeypatch.setenv("CLASH_PASSWORD", PASSWORD)
    assert auth.verify_token(auth.issue_token())


def test_expired_token_is_rejected(monkeypatch):
    monkeypatch.setenv("CLASH_PASSWORD", PASSWORD)
    assert not auth.verify_token(auth.issue_token(ttl_hours=-1))


def test_tampered_token_is_rejected(monkeypatch):
    monkeypatch.setenv("CLASH_PASSWORD", PASSWORD)
    token = auth.issue_token()
    expiry, _, signature = token.partition(".")
    # Push the expiry far into the future without re-signing.
    forged = f"{int(expiry) + 10_000_000}.{signature}"
    assert not auth.verify_token(forged)


def test_malformed_tokens_are_rejected(monkeypatch):
    monkeypatch.setenv("CLASH_PASSWORD", PASSWORD)
    for bad in (None, "", "nodot", "abc.def", ".", "..."):
        assert not auth.verify_token(bad)


def test_changing_the_password_invalidates_old_sessions(monkeypatch):
    monkeypatch.setenv("CLASH_PASSWORD", PASSWORD)
    token = auth.issue_token()
    monkeypatch.setenv("CLASH_PASSWORD", "a-different-password")
    assert not auth.verify_token(token), "rotating the password must log everyone out"


def test_explicit_secret_survives_password_change(monkeypatch):
    monkeypatch.setenv("CLASH_SECRET", "a-stable-signing-key")
    monkeypatch.setenv("CLASH_PASSWORD", PASSWORD)
    token = auth.issue_token()
    monkeypatch.setenv("CLASH_PASSWORD", "changed")
    assert auth.verify_token(token)


def test_wrong_password_rejected(monkeypatch):
    monkeypatch.setenv("CLASH_PASSWORD", PASSWORD)
    assert auth.check_password(PASSWORD)
    assert not auth.check_password("nope")
    assert not auth.check_password("")


# --------------------------------------------------------------------------- #
# the gate
# --------------------------------------------------------------------------- #

def test_unauthenticated_api_call_is_401(secured):
    assert secured.post("/api/analyze", json={"url": "x"}).status_code == 401


def test_unauthenticated_page_redirects_to_login(secured):
    response = secured.get("/", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"].startswith("/login")


def test_rendered_clips_are_not_public(secured):
    """The clips mount serves finished videos — it must be behind the gate too."""
    response = secured.get("/clips/anything.mp4", follow_redirects=False)
    assert response.status_code in (302, 401)


def test_login_page_and_health_stay_reachable(secured):
    assert secured.get("/login").status_code == 200
    assert secured.get("/api/health").status_code == 200


def test_login_with_correct_password_unlocks_the_app(secured):
    assert secured.post("/api/login", json={"password": PASSWORD}).status_code == 200
    # The TestClient keeps the cookie, so the next call should pass the gate.
    assert secured.get("/api/health").json()["auth_required"] is True
    assert secured.get("/", follow_redirects=False).status_code == 200


def test_login_with_wrong_password_is_401(secured):
    assert secured.post("/api/login", json={"password": "wrong"}).status_code == 401
    assert secured.get("/", follow_redirects=False).status_code == 302


def test_logout_revokes_the_session(secured):
    secured.post("/api/login", json={"password": PASSWORD})
    assert secured.get("/", follow_redirects=False).status_code == 200
    secured.post("/api/logout")
    assert secured.get("/", follow_redirects=False).status_code == 302


def test_no_password_means_no_gate(open_instance):
    assert open_instance.get("/", follow_redirects=False).status_code == 200
    assert open_instance.get("/api/health").json()["auth_required"] is False


# --------------------------------------------------------------------------- #
# disk housekeeping
# --------------------------------------------------------------------------- #

@pytest.fixture
def temp_storage(tmp_path, monkeypatch):
    from app import config, storage

    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "CLIP_DIR", tmp_path / "clips")
    monkeypatch.setattr(config, "SOURCE_DIR", tmp_path / "sources")
    config.CLIP_DIR.mkdir(parents=True, exist_ok=True)
    config.SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    return storage, config


def _make(directory: Path, name: str, size: int, age_hours: float) -> Path:
    path = directory / name
    path.mkdir(parents=True, exist_ok=True)
    blob = path / "video.mp4"
    blob.write_bytes(b"\0" * size)
    when = time.time() - age_hours * 3600
    import os

    os.utime(blob, (when, when))
    os.utime(path, (when, when))
    return path


def test_reaper_deletes_expired_entries(temp_storage):
    storage, config = temp_storage
    monkey_old = _make(config.CLIP_DIR, "old", 1000, age_hours=48)
    fresh = _make(config.CLIP_DIR, "fresh", 1000, age_hours=1)

    monkeypatch_ttl(config, clip=12, source=6)
    removed = storage.reap()

    assert not monkey_old.exists()
    assert fresh.exists()
    assert removed["clips"] == 1


def test_reaper_leaves_everything_when_ttl_disabled(temp_storage):
    storage, config = temp_storage
    old = _make(config.CLIP_DIR, "old", 1000, age_hours=100)
    monkeypatch_ttl(config, clip=0, source=0)
    config.MAX_DISK_BYTES = 0
    storage.reap()
    assert old.exists()


def test_disk_cap_evicts_oldest_first(temp_storage):
    storage, config = temp_storage
    oldest = _make(config.SOURCE_DIR, "a", 5_000, age_hours=5)
    middle = _make(config.SOURCE_DIR, "b", 5_000, age_hours=3)
    newest = _make(config.SOURCE_DIR, "c", 5_000, age_hours=1)

    monkeypatch_ttl(config, clip=999, source=999)
    config.MAX_DISK_BYTES = 11_000  # room for two of the three

    storage.reap()

    assert not oldest.exists(), "oldest should be evicted first"
    assert newest.exists(), "the most recent download should survive"
    assert storage.usage()["used_bytes"] <= config.MAX_DISK_BYTES


def test_usage_reports_bytes(temp_storage):
    storage, config = temp_storage
    _make(config.CLIP_DIR, "x", 2_000, age_hours=1)
    assert storage.usage()["used_bytes"] >= 2_000


def monkeypatch_ttl(config, clip: float, source: float) -> None:
    config.CLIP_TTL_HOURS = clip
    config.SOURCE_TTL_HOURS = source


# --------------------------------------------------------------------------- #
# source length ceiling
# --------------------------------------------------------------------------- #

def test_overlong_video_is_refused(monkeypatch, tmp_path):
    from app import config, ingest, pipeline
    from app.models import SourceVideo

    monkeypatch.setattr(config, "MAX_SOURCE_MINUTES", 60)
    monkeypatch.setattr(
        ingest, "probe",
        lambda url: SourceVideo("long", "A 5 hour stream", url, None, 5 * 3600),
    )
    with pytest.raises(RuntimeError, match="accepts up to 60"):
        pipeline.analyze("https://example.com/x")


def test_video_within_the_ceiling_is_not_refused(monkeypatch):
    """The guard must not fire on ordinary videos."""
    from app import config, ingest, pipeline
    from app.models import SourceVideo

    monkeypatch.setattr(config, "MAX_SOURCE_MINUTES", 60)
    monkeypatch.setattr(
        ingest, "probe",
        lambda url: SourceVideo("ok", "A 30 minute talk", url, None, 30 * 60),
    )
    monkeypatch.setattr(ingest, "fetch_captions", lambda url, vid: None)

    def no_media(*args, **kwargs):
        raise RuntimeError("download reached")

    monkeypatch.setattr(ingest, "download_media", no_media)
    # Fails later, at the download — which proves the length guard let it past.
    with pytest.raises(RuntimeError, match="download reached"):
        pipeline.analyze("https://example.com/x")
