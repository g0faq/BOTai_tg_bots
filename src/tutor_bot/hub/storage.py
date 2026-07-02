from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def utc_now() -> datetime:
    return datetime.now(UTC)


def _dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


class HubStorage:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.init_schema()

    def close(self) -> None:
        self.conn.close()

    def init_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS managed_bots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_user_id INTEGER NOT NULL,
                bot_token TEXT NOT NULL,
                bot_id INTEGER NOT NULL,
                bot_username TEXT NOT NULL,
                bot_name TEXT NOT NULL,
                tutor_name TEXT NOT NULL,
                tutor_telegram_username TEXT NOT NULL DEFAULT '',
                tutor_chat_id INTEGER,
                status TEXT NOT NULL DEFAULT 'active',
                plan_name TEXT NOT NULL DEFAULT '',
                plan_price INTEGER NOT NULL DEFAULT 0,
                last_payment_at TEXT,
                next_payment_at TEXT,
                payment_status TEXT NOT NULL DEFAULT 'unpaid',
                notes TEXT NOT NULL DEFAULT '',
                workspace_path TEXT NOT NULL DEFAULT '',
                database_path TEXT NOT NULL DEFAULT '',
                webapp_url TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_bots_bot_id ON managed_bots(bot_id);
            CREATE INDEX IF NOT EXISTS idx_managed_bots_status ON managed_bots(status);

            CREATE TABLE IF NOT EXISTS bot_stats_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                managed_bot_id INTEGER NOT NULL REFERENCES managed_bots(id) ON DELETE CASCADE,
                students_count INTEGER NOT NULL DEFAULT 0,
                lessons_today INTEGER NOT NULL DEFAULT 0,
                lessons_week INTEGER NOT NULL DEFAULT 0,
                income_today INTEGER NOT NULL DEFAULT 0,
                income_week INTEGER NOT NULL DEFAULT 0,
                income_month INTEGER NOT NULL DEFAULT 0,
                expected_payments INTEGER NOT NULL DEFAULT 0,
                debts_amount INTEGER NOT NULL DEFAULT 0,
                homework_count INTEGER NOT NULL DEFAULT 0,
                last_activity_at TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_bot_stats_bot ON bot_stats_snapshots(managed_bot_id, created_at);

            CREATE TABLE IF NOT EXISTS hub_browser_invites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_hash TEXT NOT NULL UNIQUE,
                owner_user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_hub_browser_invites_token ON hub_browser_invites(token_hash);

            CREATE TABLE IF NOT EXISTS hub_browser_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_hash TEXT NOT NULL UNIQUE,
                owner_user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT,
                last_seen_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_hub_browser_sessions_token ON hub_browser_sessions(token_hash);
            """
        )
        self.conn.commit()
        self._ensure_column("managed_bots", "workspace_path", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("managed_bots", "database_path", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("managed_bots", "webapp_url", "TEXT NOT NULL DEFAULT ''")

    def _ensure_column(self, table: str, column: str, definition: str) -> None:
        columns = {row["name"] for row in self.conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in columns:
            self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            self.conn.commit()

    def upsert_managed_bot(self, payload: dict[str, Any]) -> dict[str, Any]:
        now = _dt(utc_now())
        existing = self.conn.execute(
            "SELECT id FROM managed_bots WHERE bot_id = ?",
            (payload["bot_id"],),
        ).fetchone()
        values = {
            "owner_user_id": payload["owner_user_id"],
            "bot_token": payload["bot_token"],
            "bot_id": payload["bot_id"],
            "bot_username": payload["bot_username"],
            "bot_name": payload["bot_name"],
            "tutor_name": payload["tutor_name"],
            "tutor_telegram_username": payload.get("tutor_telegram_username") or "",
            "tutor_chat_id": payload.get("tutor_chat_id"),
            "status": payload.get("status") or "active",
            "plan_name": payload.get("plan_name") or "",
            "plan_price": int(payload.get("plan_price") or 0),
            "last_payment_at": payload.get("last_payment_at"),
            "next_payment_at": payload.get("next_payment_at"),
            "payment_status": payload.get("payment_status") or "unpaid",
            "notes": payload.get("notes") or "",
            "workspace_path": payload.get("workspace_path") or "",
            "database_path": payload.get("database_path") or "",
            "webapp_url": payload.get("webapp_url") or "",
        }
        if existing:
            assignments = ", ".join(f"{key} = ?" for key in values)
            self.conn.execute(
                f"UPDATE managed_bots SET {assignments}, updated_at = ? WHERE id = ?",
                (*values.values(), now, int(existing["id"])),
            )
            bot_id = int(existing["id"])
        else:
            columns = ", ".join([*values.keys(), "created_at", "updated_at"])
            placeholders = ", ".join("?" for _ in [*values.keys(), "created_at", "updated_at"])
            cursor = self.conn.execute(
                f"INSERT INTO managed_bots({columns}) VALUES ({placeholders})",
                (*values.values(), now, now),
            )
            bot_id = int(cursor.lastrowid)
        self.conn.commit()
        bot = self.get_managed_bot(bot_id)
        if bot is None:
            raise RuntimeError("managed bot was not saved")
        return bot

    def list_managed_bots(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM managed_bots ORDER BY created_at DESC").fetchall()
        return [self._redact_bot(row) for row in rows]

    def get_managed_bot(self, bot_id: int) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM managed_bots WHERE id = ?", (bot_id,)).fetchone()
        return self._redact_bot(row) if row else None

    def get_managed_bot_with_token(self, bot_id: int) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM managed_bots WHERE id = ?", (bot_id,)).fetchone()
        return dict(row) if row else None

    def update_managed_bot(self, bot_id: int, updates: dict[str, Any]) -> dict[str, Any]:
        allowed = {
            "tutor_name",
            "tutor_telegram_username",
            "tutor_chat_id",
            "status",
            "plan_name",
            "plan_price",
            "last_payment_at",
            "next_payment_at",
            "payment_status",
            "notes",
            "workspace_path",
            "database_path",
            "webapp_url",
        }
        cleaned = {key: value for key, value in updates.items() if key in allowed}
        if cleaned:
            assignments = ", ".join(f"{key} = ?" for key in cleaned)
            self.conn.execute(
                f"UPDATE managed_bots SET {assignments}, updated_at = ? WHERE id = ?",
                (*cleaned.values(), _dt(utc_now()), bot_id),
            )
            self.conn.commit()
        bot = self.get_managed_bot(bot_id)
        if bot is None:
            raise KeyError("managed bot not found")
        return bot

    def delete_managed_bot(self, bot_id: int) -> None:
        self.conn.execute("DELETE FROM managed_bots WHERE id = ?", (bot_id,))
        self.conn.commit()

    def add_stats_snapshot(self, managed_bot_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        now = _dt(utc_now())
        cursor = self.conn.execute(
            """
            INSERT INTO bot_stats_snapshots(
                managed_bot_id, students_count, lessons_today, lessons_week, income_today,
                income_week, income_month, expected_payments, debts_amount, homework_count,
                last_activity_at, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                managed_bot_id,
                int(payload.get("students_count") or 0),
                int(payload.get("lessons_today") or 0),
                int(payload.get("lessons_week") or 0),
                int(payload.get("income_today") or 0),
                int(payload.get("income_week") or 0),
                int(payload.get("income_month") or 0),
                int(payload.get("expected_payments") or 0),
                int(payload.get("debts_amount") or 0),
                int(payload.get("homework_count") or 0),
                payload.get("last_activity_at"),
                now,
            ),
        )
        self.conn.commit()
        return dict(self.conn.execute("SELECT * FROM bot_stats_snapshots WHERE id = ?", (cursor.lastrowid,)).fetchone())

    def latest_stats(self, managed_bot_id: int) -> dict[str, Any] | None:
        row = self.conn.execute(
            """
            SELECT * FROM bot_stats_snapshots
            WHERE managed_bot_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """,
            (managed_bot_id,),
        ).fetchone()
        return dict(row) if row else None

    def overview(self) -> dict[str, Any]:
        bots = self.list_managed_bots()
        stats = [self.latest_stats(int(bot["id"])) or {} for bot in bots]
        return {
            "total_bots": len(bots),
            "active_bots": len([bot for bot in bots if bot["status"] == "active"]),
            "disabled_bots": len([bot for bot in bots if bot["status"] in {"paused", "disabled", "overdue"}]),
            "tutor_income_month": sum(int(item.get("income_month") or 0) for item in stats),
            "expected_revenue": sum(int(bot.get("plan_price") or 0) for bot in bots if bot["status"] != "disabled"),
            "overdue_payments": len([bot for bot in bots if bot["payment_status"] == "overdue" or bot["status"] == "overdue"]),
            "students_count": sum(int(item.get("students_count") or 0) for item in stats),
            "lessons_today": sum(int(item.get("lessons_today") or 0) for item in stats),
            "lessons_week": sum(int(item.get("lessons_week") or 0) for item in stats),
        }

    def add_browser_invite(self, token_hash: str, owner_user_id: int, expires_at: str | None = None) -> None:
        self.conn.execute(
            "INSERT INTO hub_browser_invites(token_hash, owner_user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token_hash, owner_user_id, _dt(utc_now()), expires_at),
        )
        self.conn.commit()

    def get_browser_invite(self, token_hash: str) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM hub_browser_invites WHERE token_hash = ?", (token_hash,)).fetchone()
        return dict(row) if row else None

    def add_browser_session(self, token_hash: str, owner_user_id: int) -> None:
        now = _dt(utc_now())
        self.conn.execute(
            "INSERT INTO hub_browser_sessions(token_hash, owner_user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
            (token_hash, owner_user_id, now, now),
        )
        self.conn.commit()

    def get_browser_session(self, token_hash: str) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM hub_browser_sessions WHERE token_hash = ?", (token_hash,)).fetchone()
        return dict(row) if row else None

    def touch_browser_session(self, session_id: int) -> None:
        self.conn.execute("UPDATE hub_browser_sessions SET last_seen_at = ? WHERE id = ?", (_dt(utc_now()), session_id))
        self.conn.commit()

    def _redact_bot(self, row: sqlite3.Row) -> dict[str, Any]:
        data = dict(row)
        data.pop("bot_token", None)
        return data
