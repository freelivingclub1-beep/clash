"""Local index of everything generated.

Deliberately stores *no audio*. Treblo already keeps the audio on the account;
duplicating it locally is what eats phone storage. What lives here is the
metadata needed to (a) find a song again and (b) guarantee that song 33 never
reuses a bar from song 1.

Schema:
  songs     one row per generated song
  lines     every lyric line ever accepted, normalized for comparison
  shingles  inverted index of word n-grams -> line, for fast overlap lookup
  events    append-only log of what the runner did and why
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
    id           INTEGER PRIMARY KEY,
    job_id       TEXT,
    created_at   REAL NOT NULL,
    tags         TEXT NOT NULL,
    lyric_mode   TEXT NOT NULL,
    theme        TEXT,
    status       TEXT NOT NULL,
    treblo_url   TEXT,
    title        TEXT
);
CREATE TABLE IF NOT EXISTS lines (
    id          INTEGER PRIMARY KEY,
    song_id     INTEGER REFERENCES songs(id),
    position    INTEGER NOT NULL,
    text        TEXT NOT NULL,
    normalized  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lines_normalized ON lines(normalized);
CREATE TABLE IF NOT EXISTS shingles (
    shingle  TEXT NOT NULL,
    line_id  INTEGER NOT NULL REFERENCES lines(id)
);
CREATE INDEX IF NOT EXISTS idx_shingles_shingle ON shingles(shingle);
CREATE TABLE IF NOT EXISTS events (
    id      INTEGER PRIMARY KEY,
    at      REAL NOT NULL,
    kind    TEXT NOT NULL,
    detail  TEXT
);
"""


@dataclass
class Song:
    id: int
    job_id: str | None
    created_at: float
    tags: list[str]
    lyric_mode: str
    theme: str | None
    status: str
    treblo_url: str | None
    title: str | None


class Library:
    def __init__(self, path: str | Path = "treblo.db") -> None:
        self.path = str(path)
        self.conn = sqlite3.connect(self.path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    # -- songs ------------------------------------------------------------

    def add_song(
        self,
        *,
        created_at: float,
        tags: list[str],
        lyric_mode: str,
        status: str = "queued",
        job_id: str | None = None,
        theme: str | None = None,
        treblo_url: str | None = None,
        title: str | None = None,
    ) -> int:
        cur = self.conn.execute(
            "INSERT INTO songs (job_id, created_at, tags, lyric_mode, theme, status,"
            " treblo_url, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (job_id, created_at, json.dumps(tags), lyric_mode, theme, status, treblo_url, title),
        )
        self.conn.commit()
        return int(cur.lastrowid)

    def update_song(self, song_id: int, **fields) -> None:
        if not fields:
            return
        allowed = {"job_id", "status", "treblo_url", "title", "theme"}
        unknown = set(fields) - allowed
        if unknown:
            raise ValueError(f"cannot update fields: {sorted(unknown)}")
        assignments = ", ".join(f"{k} = ?" for k in fields)
        self.conn.execute(
            f"UPDATE songs SET {assignments} WHERE id = ?", (*fields.values(), song_id)
        )
        self.conn.commit()

    def get_song(self, song_id: int) -> Song | None:
        row = self.conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
        return _to_song(row) if row else None

    def songs(self, status: str | None = None, limit: int = 50) -> list[Song]:
        if status:
            rows = self.conn.execute(
                "SELECT * FROM songs WHERE status = ? ORDER BY created_at DESC LIMIT ?",
                (status, limit),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM songs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [_to_song(r) for r in rows]

    def song_count(self) -> int:
        return int(self.conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0])

    # -- lyric corpus -----------------------------------------------------

    def add_lines(self, song_id: int, lines: list[tuple[str, str, list[str]]]) -> None:
        """Store accepted lines. Each entry is (text, normalized, shingles)."""
        for position, (text, normalized, shingles) in enumerate(lines):
            cur = self.conn.execute(
                "INSERT INTO lines (song_id, position, text, normalized) VALUES (?, ?, ?, ?)",
                (song_id, position, text, normalized),
            )
            line_id = cur.lastrowid
            self.conn.executemany(
                "INSERT INTO shingles (shingle, line_id) VALUES (?, ?)",
                [(s, line_id) for s in shingles],
            )
        self.conn.commit()

    def has_exact_line(self, normalized: str) -> bool:
        row = self.conn.execute(
            "SELECT 1 FROM lines WHERE normalized = ? LIMIT 1", (normalized,)
        ).fetchone()
        return row is not None

    def lines_sharing_shingles(self, shingles: list[str]) -> dict[int, int]:
        """Map line_id -> number of shared shingles, for candidate lines only.

        The inverted index means we compare against the handful of lines that
        share at least one n-gram rather than the whole corpus, so this stays
        fast as the library grows into the thousands.
        """
        if not shingles:
            return {}
        placeholders = ",".join("?" * len(shingles))
        rows = self.conn.execute(
            f"SELECT line_id, COUNT(*) AS shared FROM shingles"
            f" WHERE shingle IN ({placeholders}) GROUP BY line_id",
            shingles,
        ).fetchall()
        return {int(r["line_id"]): int(r["shared"]) for r in rows}

    def shingle_count(self, line_id: int) -> int:
        row = self.conn.execute(
            "SELECT COUNT(*) FROM shingles WHERE line_id = ?", (line_id,)
        ).fetchone()
        return int(row[0])

    def line_text(self, line_id: int) -> str | None:
        row = self.conn.execute("SELECT text FROM lines WHERE id = ?", (line_id,)).fetchone()
        return row["text"] if row else None

    def line_count(self) -> int:
        return int(self.conn.execute("SELECT COUNT(*) FROM lines").fetchone()[0])

    # -- events -----------------------------------------------------------

    def log(self, at: float, kind: str, detail: str | None = None) -> None:
        self.conn.execute(
            "INSERT INTO events (at, kind, detail) VALUES (?, ?, ?)", (at, kind, detail)
        )
        self.conn.commit()

    def recent_events(self, limit: int = 20) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM events ORDER BY at DESC LIMIT ?", (limit,)
        ).fetchall()


def _to_song(row: sqlite3.Row) -> Song:
    return Song(
        id=int(row["id"]),
        job_id=row["job_id"],
        created_at=float(row["created_at"]),
        tags=json.loads(row["tags"]),
        lyric_mode=row["lyric_mode"],
        theme=row["theme"],
        status=row["status"],
        treblo_url=row["treblo_url"],
        title=row["title"],
    )
