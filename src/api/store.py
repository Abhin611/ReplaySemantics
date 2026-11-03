"""
api/store.py
------------
The account database: profiles, the event logs each user has loaded, and their history of actions.
SQLite in one local file (standard library only). REPLAY_DATA_DIR moves it, along with the stored log files.
Every read and write takes the user id, so one user can never reach another user's rows.
"""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).parent.parent.parent

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY, email TEXT, name TEXT, photo_url TEXT, provider TEXT,
    created_at TEXT NOT NULL, last_login_at TEXT NOT NULL, active_log_id INTEGER
);
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL REFERENCES users(uid),
    platform TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL, source_ref TEXT NOT NULL,
    label TEXT NOT NULL, path TEXT, events INTEGER, objects INTEGER,
    created_at TEXT NOT NULL, last_opened_at TEXT NOT NULL, UNIQUE (uid, source, source_ref)
);
CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL REFERENCES users(uid), seq INTEGER NOT NULL,
    log_id INTEGER, log_label TEXT, kind TEXT NOT NULL, case_id TEXT, params TEXT NOT NULL, snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL, UNIQUE (uid, seq)
);
"""


def data_dir() -> Path:
    return Path(os.environ.get("REPLAY_DATA_DIR", REPO_ROOT / "var"))


def upload_dir(uid: str) -> Path:
    safe = "".join(c for c in uid if c.isalnum() or c in "-_") or "user"
    path = data_dir() / "logs" / safe
    path.mkdir(parents=True, exist_ok=True)
    return path


@contextmanager
def _db():
    data_dir().mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(data_dir() / "replay.db", timeout=30)
    con.row_factory = sqlite3.Row
    try:
        con.executescript(_SCHEMA)
        yield con
        con.commit()
    finally:
        con.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def upsert_user(uid: str, email: str | None, name: str | None, photo_url: str | None, provider: str | None) -> dict:
    """Create the profile on the first login; afterwards only refresh what the sign-in provider supplies."""
    now = _now()
    with _db() as con:
        con.execute(
            """INSERT INTO users (uid, email, name, photo_url, provider, created_at, last_login_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (uid) DO UPDATE SET email = excluded.email, last_login_at = excluded.last_login_at,
                   photo_url = COALESCE(excluded.photo_url, users.photo_url),
                   provider = COALESCE(excluded.provider, users.provider),
                   name = COALESCE(users.name, excluded.name)""",
            (uid, email, name, photo_url, provider, now, now),
        )
        return dict(con.execute("SELECT * FROM users WHERE uid = ?", (uid,)).fetchone())


def set_name(uid: str, name: str) -> dict:
    with _db() as con:
        con.execute("UPDATE users SET name = ? WHERE uid = ?", (name, uid))
        return dict(con.execute("SELECT * FROM users WHERE uid = ?", (uid,)).fetchone())


def save_log(uid: str, platform: str, kind: str, source: str, source_ref: str, label: str, path: str | None,
             events: int | None, objects: int | None) -> dict:
    """Remember a log and make it the active one. Loading the same link, file or sample again reuses its row."""
    now = _now()
    with _db() as con:
        con.execute(
            """INSERT INTO logs (uid, platform, kind, source, source_ref, label, path, events, objects, created_at, last_opened_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (uid, source, source_ref) DO UPDATE SET last_opened_at = excluded.last_opened_at,
                   label = excluded.label, path = excluded.path, events = excluded.events, objects = excluded.objects""",
            (uid, platform, kind, source, source_ref, label, path, events, objects, now, now),
        )
        row = con.execute("SELECT * FROM logs WHERE uid = ? AND source = ? AND source_ref = ?", (uid, source, source_ref)).fetchone()
        con.execute("UPDATE users SET active_log_id = ? WHERE uid = ?", (row["id"], uid))
        return public_log(row)


def public_log(row) -> dict:
    """A log as the browser may see it: never the path on the server."""
    return {k: row[k] for k in ("id", "platform", "kind", "source", "label", "events", "objects", "created_at", "last_opened_at")} | {
        "url": row["source_ref"] if row["source"] == "url" else None}


def list_logs(uid: str) -> list[dict]:
    with _db() as con:
        rows = con.execute("SELECT * FROM logs WHERE uid = ? ORDER BY last_opened_at DESC, id DESC", (uid,)).fetchall()
        return [public_log(r) for r in rows]


def open_log(uid: str, log_id: int) -> dict | None:
    with _db() as con:
        row = con.execute("SELECT * FROM logs WHERE uid = ? AND id = ?", (uid, log_id)).fetchone()
        if row is None:
            return None
        con.execute("UPDATE logs SET last_opened_at = ? WHERE id = ?", (_now(), log_id))
        con.execute("UPDATE users SET active_log_id = ? WHERE uid = ?", (log_id, uid))
        return public_log(row)


def active_log(uid: str) -> dict | None:
    """The log the user is working on, including its stored path (server side only: never sent to the browser)."""
    with _db() as con:
        row = con.execute(
            "SELECT l.* FROM logs l JOIN users u ON u.active_log_id = l.id WHERE u.uid = ? AND l.uid = ?", (uid, uid)
        ).fetchone()
        return dict(row) if row else None


def add_action(uid: str, log_id: int | None, log_label: str | None, kind: str, case_id: str | None,
               params: dict[str, Any], snapshot: dict[str, Any]) -> dict:
    with _db() as con:
        con.execute("BEGIN IMMEDIATE")
        seq = con.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM actions WHERE uid = ?", (uid,)).fetchone()[0]
        cur = con.execute(
            "INSERT INTO actions (uid, seq, log_id, log_label, kind, case_id, params, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (uid, seq, log_id, log_label, kind, case_id, json.dumps(params, sort_keys=True), json.dumps(snapshot), _now()),
        )
        return _public_action(con.execute("SELECT * FROM actions WHERE id = ?", (cur.lastrowid,)).fetchone())


def _public_action(row) -> dict:
    return {"id": row["id"], "seq": row["seq"], "log_id": row["log_id"], "log_label": row["log_label"], "kind": row["kind"],
            "case_id": row["case_id"], "params": json.loads(row["params"]), "snapshot": json.loads(row["snapshot"]),
            "created_at": row["created_at"]}


def latest_action(uid: str) -> dict | None:
    with _db() as con:
        row = con.execute("SELECT * FROM actions WHERE uid = ? ORDER BY seq DESC LIMIT 1", (uid,)).fetchone()
        return _public_action(row) if row else None


def list_actions(uid: str) -> list[dict]:
    with _db() as con:
        return [_public_action(r) for r in con.execute("SELECT * FROM actions WHERE uid = ? ORDER BY seq DESC", (uid,))]


def get_actions(uid: str, ids: list[int]) -> list[dict]:
    """The user's own actions among `ids`, oldest first."""
    marks = ",".join("?" * len(ids))
    with _db() as con:
        rows = con.execute(f"SELECT * FROM actions WHERE uid = ? AND id IN ({marks}) ORDER BY seq", (uid, *ids)).fetchall()
        return [_public_action(r) for r in rows]
