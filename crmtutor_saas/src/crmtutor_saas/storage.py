from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from crmtutor_saas.models import FinanceOperationType, LessonStatus, Role
from crmtutor_saas.security import random_token, utc_now


def dt(value: datetime | None = None) -> str:
    return (value or utc_now()).isoformat()


def loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


class SaaSStorage:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.init_schema()

    def close(self) -> None:
        self.conn.close()

    def init_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS platform_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                monthly_price INTEGER NOT NULL DEFAULT 0,
                limits_json TEXT NOT NULL DEFAULT '{}',
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workspaces (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                owner_user_id INTEGER,
                plan_id INTEGER REFERENCES platform_plans(id),
                subscription_id INTEGER,
                status TEXT NOT NULL DEFAULT 'active',
                public_slug TEXT NOT NULL UNIQUE,
                domain TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE,
                telegram_id INTEGER UNIQUE,
                telegram_username TEXT NOT NULL DEFAULT '',
                password_hash TEXT NOT NULL DEFAULT '',
                first_name TEXT NOT NULL DEFAULT '',
                last_name TEXT NOT NULL DEFAULT '',
                photo_url TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workspace_memberships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(workspace_id, user_id, role)
            );
            CREATE INDEX IF NOT EXISTS idx_memberships_workspace ON workspace_memberships(workspace_id, role);
            CREATE INDEX IF NOT EXISTS idx_memberships_user ON workspace_memberships(user_id);

            CREATE TABLE IF NOT EXISTS tutor_profiles (
                workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                first_name TEXT NOT NULL DEFAULT '',
                last_name TEXT NOT NULL DEFAULT '',
                photo_url TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
                experience_years INTEGER NOT NULL DEFAULT 0,
                subjects_json TEXT NOT NULL DEFAULT '[]',
                directions_json TEXT NOT NULL DEFAULT '[]',
                hourly_price INTEGER NOT NULL DEFAULT 0,
                public_slug TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS white_label_settings (
                workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
                custom_domain TEXT NOT NULL DEFAULT '',
                logo_url TEXT NOT NULL DEFAULT '',
                colors_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS email_otps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                code_hash TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                consumed_at TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_email_otps_email ON email_otps(email, expires_at);

            CREATE TABLE IF NOT EXISTS refresh_tokens (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                revoked_at TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                plan_id INTEGER NOT NULL REFERENCES platform_plans(id),
                status TEXT NOT NULL DEFAULT 'trialing',
                trial_ends_at TEXT,
                current_period_starts_at TEXT NOT NULL,
                current_period_ends_at TEXT NOT NULL,
                cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
                provider TEXT NOT NULL DEFAULT 'manual',
                provider_customer_id TEXT NOT NULL DEFAULT '',
                provider_subscription_id TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace ON subscriptions(workspace_id, status);

            CREATE TABLE IF NOT EXISTS billing_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
                type TEXT NOT NULL,
                amount INTEGER NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'RUB',
                status TEXT NOT NULL DEFAULT 'pending',
                provider TEXT NOT NULL DEFAULT 'manual',
                provider_event_id TEXT NOT NULL DEFAULT '',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_billing_workspace ON billing_events(workspace_id, created_at);

            CREATE TABLE IF NOT EXISTS telegram_link_tokens (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                consumed_at TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                legacy_id INTEGER,
                full_name TEXT NOT NULL,
                grade TEXT NOT NULL DEFAULT '',
                timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
                subject TEXT NOT NULL DEFAULT '',
                prep_type TEXT NOT NULL DEFAULT '',
                goal TEXT NOT NULL DEFAULT '',
                current_level TEXT NOT NULL DEFAULT '',
                lesson_price INTEGER NOT NULL DEFAULT 0,
                price_60 INTEGER NOT NULL DEFAULT 0,
                price_90 INTEGER NOT NULL DEFAULT 0,
                price_120 INTEGER NOT NULL DEFAULT 0,
                lesson_duration_minutes INTEGER NOT NULL DEFAULT 60,
                balance_lessons INTEGER NOT NULL DEFAULT 0,
                balance_money INTEGER NOT NULL DEFAULT 0,
                progress_current INTEGER NOT NULL DEFAULT 0,
                progress_goal INTEGER NOT NULL DEFAULT 0,
                prep_plan_text TEXT NOT NULL DEFAULT '',
                prep_plan_file_id TEXT NOT NULL DEFAULT '',
                start_date TEXT,
                exam_date TEXT,
                status TEXT NOT NULL DEFAULT 'lead',
                student_telegram TEXT NOT NULL DEFAULT '',
                parent_name TEXT NOT NULL DEFAULT '',
                parent_telegram TEXT NOT NULL DEFAULT '',
                parent_can_edit INTEGER NOT NULL DEFAULT 0,
                board_url TEXT NOT NULL DEFAULT '',
                meeting_url TEXT NOT NULL DEFAULT '',
                comment TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE(workspace_id, legacy_id)
            );
            CREATE INDEX IF NOT EXISTS idx_students_workspace ON students(workspace_id, status);

            CREATE TABLE IF NOT EXISTS teachers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                full_name TEXT NOT NULL,
                subjects_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_teachers_workspace ON teachers(workspace_id);

            CREATE TABLE IF NOT EXISTS parents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                full_name TEXT NOT NULL,
                contact TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_parents_workspace ON parents(workspace_id);

            CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                teacher_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                legacy_id INTEGER,
                starts_at TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'planned',
                topic TEXT NOT NULL DEFAULT '',
                next_plan TEXT NOT NULL DEFAULT '',
                cancellation_reason TEXT NOT NULL DEFAULT '',
                cancelled_by TEXT NOT NULL DEFAULT '',
                stable_series_id TEXT NOT NULL DEFAULT '',
                payment_status TEXT NOT NULL DEFAULT 'not_paid',
                payment_marked_by TEXT NOT NULL DEFAULT '',
                payment_confirmed_at TEXT,
                payment_amount INTEGER NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE(workspace_id, legacy_id)
            );
            CREATE INDEX IF NOT EXISTS idx_lessons_workspace_time ON lessons(workspace_id, starts_at);
            CREATE INDEX IF NOT EXISTS idx_lessons_student ON lessons(workspace_id, student_id, starts_at);

            CREATE TABLE IF NOT EXISTS homeworks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                teacher_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                legacy_id INTEGER,
                title TEXT NOT NULL DEFAULT '',
                text TEXT NOT NULL,
                deadline TEXT,
                status TEXT NOT NULL DEFAULT 'assigned',
                materials_json TEXT NOT NULL DEFAULT '[]',
                links_json TEXT NOT NULL DEFAULT '[]',
                teacher_comment TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT,
                checked_at TEXT,
                UNIQUE(workspace_id, legacy_id)
            );
            CREATE INDEX IF NOT EXISTS idx_homeworks_workspace ON homeworks(workspace_id, student_id, status);

            CREATE TABLE IF NOT EXISTS homework_submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                homework_id INTEGER NOT NULL REFERENCES homeworks(id) ON DELETE CASCADE,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                content TEXT NOT NULL DEFAULT '',
                file_urls_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS prep_topics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                legacy_id INTEGER,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'не начинали',
                solved_count INTEGER NOT NULL DEFAULT 0,
                knowledge_level INTEGER NOT NULL DEFAULT 0,
                comment TEXT NOT NULL DEFAULT '',
                UNIQUE(workspace_id, legacy_id)
            );
            CREATE INDEX IF NOT EXISTS idx_prep_topics_student ON prep_topics(workspace_id, student_id);

            CREATE TABLE IF NOT EXISTS plan_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                legacy_id INTEGER,
                title TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'не начато',
                comment TEXT NOT NULL DEFAULT '',
                deadline TEXT,
                UNIQUE(workspace_id, legacy_id)
            );
            CREATE INDEX IF NOT EXISTS idx_plan_items_student ON plan_items(workspace_id, student_id, position);

            CREATE TABLE IF NOT EXISTS schedule_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                legacy_id INTEGER,
                weekdays_json TEXT NOT NULL DEFAULT '[]',
                lesson_time TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL DEFAULT 60,
                starts_at TEXT,
                ends_at TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                UNIQUE(workspace_id, legacy_id)
            );
            CREATE INDEX IF NOT EXISTS idx_schedule_rules_student ON schedule_rules(workspace_id, student_id);

            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
                legacy_id INTEGER,
                amount INTEGER NOT NULL DEFAULT 0,
                lessons_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                comment TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                confirmed_at TEXT,
                UNIQUE(workspace_id, legacy_id)
            );
            CREATE INDEX IF NOT EXISTS idx_payments_workspace ON payments(workspace_id, student_id, created_at);

            CREATE TABLE IF NOT EXISTS finance_operations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
                lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
                payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
                type TEXT NOT NULL,
                amount INTEGER NOT NULL DEFAULT 0,
                lessons_delta INTEGER NOT NULL DEFAULT 0,
                balance_lessons_after INTEGER,
                balance_money_after INTEGER,
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_finance_workspace ON finance_operations(workspace_id, created_at);

            CREATE TABLE IF NOT EXISTS applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                tutor_profile_id INTEGER REFERENCES tutor_profiles(workspace_id) ON DELETE CASCADE,
                student_name TEXT NOT NULL,
                contact TEXT NOT NULL,
                selected_slot TEXT NOT NULL DEFAULT '',
                comment TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'new',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_applications_workspace ON applications(workspace_id, status, created_at);

            CREATE TABLE IF NOT EXISTS invitation_links (
                token TEXT PRIMARY KEY,
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                expires_at TEXT,
                used_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                used_at TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_invites_workspace ON invitation_links(workspace_id, role);

            CREATE TABLE IF NOT EXISTS notification_settings (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                telegram_enabled INTEGER NOT NULL DEFAULT 1,
                email_enabled INTEGER NOT NULL DEFAULT 1,
                reminder_offsets_json TEXT NOT NULL DEFAULT '[1440,180,60,15]',
                mass_mailing_enabled INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS notification_outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                telegram_id INTEGER,
                channel TEXT NOT NULL,
                type TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}',
                status TEXT NOT NULL DEFAULT 'pending',
                scheduled_at TEXT NOT NULL,
                sent_at TEXT,
                error TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_notification_outbox_status ON notification_outbox(channel, status, scheduled_at);
            """
        )
        self.conn.commit()
        self.seed_default_plans()
        self._ensure_column("workspaces", "subscription_id", "INTEGER")
        self._ensure_column("tutor_profiles", "timezone", "TEXT NOT NULL DEFAULT 'Europe/Moscow'")
        self._ensure_student_columns()
        self._ensure_lesson_columns()
        self._ensure_column("users", "password_hash", "TEXT NOT NULL DEFAULT ''")

    def _ensure_student_columns(self) -> None:
        for column, definition in {
            "current_level": "TEXT NOT NULL DEFAULT ''",
            "price_60": "INTEGER NOT NULL DEFAULT 0",
            "price_90": "INTEGER NOT NULL DEFAULT 0",
            "price_120": "INTEGER NOT NULL DEFAULT 0",
            "lesson_duration_minutes": "INTEGER NOT NULL DEFAULT 60",
            "progress_current": "INTEGER NOT NULL DEFAULT 0",
            "progress_goal": "INTEGER NOT NULL DEFAULT 0",
            "prep_plan_text": "TEXT NOT NULL DEFAULT ''",
            "prep_plan_file_id": "TEXT NOT NULL DEFAULT ''",
            "start_date": "TEXT",
            "exam_date": "TEXT",
            "parent_can_edit": "INTEGER NOT NULL DEFAULT 0",
        }.items():
            self._ensure_column("students", column, definition)

    def _ensure_lesson_columns(self) -> None:
        for column, definition in {
            "next_plan": "TEXT NOT NULL DEFAULT ''",
            "cancellation_reason": "TEXT NOT NULL DEFAULT ''",
            "cancelled_by": "TEXT NOT NULL DEFAULT ''",
            "stable_series_id": "TEXT NOT NULL DEFAULT ''",
            "payment_marked_by": "TEXT NOT NULL DEFAULT ''",
            "payment_confirmed_at": "TEXT",
        }.items():
            self._ensure_column("lessons", column, definition)

    def _ensure_column(self, table: str, column: str, definition: str) -> None:
        columns = {row["name"] for row in self.conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in columns:
            self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            self.conn.commit()

    def seed_default_plans(self) -> None:
        defaults = [
            ("standart", "Standart", 3000, {"students": 40, "teachers": 1, "files": 1000, "active_lessons": 300}),
            ("pro", "Pro", 6000, {"students": 150, "teachers": 5, "files": 10000, "active_lessons": 1200}),
            ("school", "School", 10000, {"students": 1000, "teachers": 50, "files": 50000, "active_lessons": 10000}),
        ]
        for code, name, price, limits in defaults:
            self.conn.execute(
                """
                INSERT INTO platform_plans(code, name, monthly_price, limits_json, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(code) DO UPDATE SET
                    name = excluded.name,
                    monthly_price = excluded.monthly_price,
                    limits_json = excluded.limits_json,
                    is_active = 1
                """,
                (code, name, price, json.dumps(limits, ensure_ascii=False), dt()),
            )
        self.conn.execute("UPDATE platform_plans SET is_active = 0 WHERE code = 'free'")
        self.conn.execute(
            """
            UPDATE workspaces
            SET plan_id = (SELECT id FROM platform_plans WHERE code = 'standart')
            WHERE plan_id IN (SELECT id FROM platform_plans WHERE code = 'free')
               OR plan_id IS NULL
            """
        )
        self.conn.commit()

    def row(self, query: str, params: Iterable[Any] = ()) -> dict[str, Any] | None:
        result = self.conn.execute(query, tuple(params)).fetchone()
        return dict(result) if result else None

    def rows(self, query: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
        return [dict(row) for row in self.conn.execute(query, tuple(params)).fetchall()]

    def create_or_get_user(
        self,
        *,
        email: str | None = None,
        telegram_id: int | None = None,
        telegram_username: str = "",
        password_hash: str = "",
        first_name: str = "",
        last_name: str = "",
        photo_url: str = "",
    ) -> dict[str, Any]:
        existing = None
        if email:
            existing = self.row("SELECT * FROM users WHERE email = ?", (email.lower(),))
        if existing is None and telegram_id is not None:
            existing = self.row("SELECT * FROM users WHERE telegram_id = ?", (telegram_id,))
        if existing:
            self.conn.execute(
                """
                UPDATE users
                SET email = COALESCE(email, ?),
                    telegram_id = COALESCE(telegram_id, ?),
                    telegram_username = CASE WHEN ? != '' THEN ? ELSE telegram_username END,
                    password_hash = CASE WHEN ? != '' THEN ? ELSE password_hash END,
                    first_name = CASE WHEN ? != '' THEN ? ELSE first_name END,
                    last_name = CASE WHEN ? != '' THEN ? ELSE last_name END,
                    photo_url = CASE WHEN ? != '' THEN ? ELSE photo_url END
                WHERE id = ?
                """,
                (
                    email.lower() if email else None,
                    telegram_id,
                    telegram_username,
                    telegram_username,
                    password_hash,
                    password_hash,
                    first_name,
                    first_name,
                    last_name,
                    last_name,
                    photo_url,
                    photo_url,
                    existing["id"],
                ),
            )
            self.conn.commit()
            return self.row("SELECT * FROM users WHERE id = ?", (existing["id"],)) or existing

        cur = self.conn.execute(
            """
            INSERT INTO users(email, telegram_id, telegram_username, password_hash, first_name, last_name, photo_url, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (email.lower() if email else None, telegram_id, telegram_username, password_hash, first_name, last_name, photo_url, dt()),
        )
        self.conn.commit()
        return self.row("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)) or {}

    def create_workspace(
        self,
        *,
        owner_user_id: int,
        slug: str,
        name: str,
        public_slug: str,
        first_name: str,
        last_name: str = "",
        photo_url: str = "",
        description: str = "",
        subjects: list[str] | None = None,
        directions: list[str] | None = None,
        hourly_price: int = 0,
        experience_years: int = 0,
        timezone: str = "Europe/Moscow",
        plan_code: str = "standart",
    ) -> dict[str, Any]:
        plan = self.row("SELECT id FROM platform_plans WHERE code = ?", (plan_code,))
        cur = self.conn.execute(
            """
            INSERT INTO workspaces(slug, name, owner_user_id, plan_id, public_slug, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (slug, name, owner_user_id, plan["id"] if plan else None, public_slug, dt()),
        )
        workspace_id = int(cur.lastrowid)
        self.conn.execute(
            "UPDATE workspaces SET owner_user_id = ? WHERE id = ?", (owner_user_id, workspace_id)
        )
        self.conn.execute(
            """
            INSERT INTO workspace_memberships(workspace_id, user_id, role, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (workspace_id, owner_user_id, Role.TUTOR.value, dt()),
        )
        self.conn.execute(
            """
            INSERT INTO tutor_profiles(
                workspace_id, user_id, first_name, last_name, photo_url, description, timezone,
                experience_years, subjects_json, directions_json, hourly_price, public_slug, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workspace_id,
                owner_user_id,
                first_name,
                last_name,
                photo_url,
                description,
                timezone,
                experience_years,
                json.dumps(subjects or [], ensure_ascii=False),
                json.dumps(directions or [], ensure_ascii=False),
                hourly_price,
                public_slug,
                dt(),
            ),
        )
        self.conn.execute(
            "INSERT INTO white_label_settings(workspace_id, created_at) VALUES (?, ?)",
            (workspace_id, dt()),
        )
        subscription_id = self.create_subscription(workspace_id, int(plan["id"]) if plan else 1)["id"]
        self.conn.execute(
            "UPDATE workspaces SET subscription_id = ? WHERE id = ?",
            (subscription_id, workspace_id),
        )
        self.conn.commit()
        return self.get_workspace(workspace_id) or {}

    def get_tutor_profile_by_workspace(self, workspace_id: int) -> dict[str, Any] | None:
        row = self.row("SELECT * FROM tutor_profiles WHERE workspace_id = ?", (workspace_id,))
        if row:
            row["subjects"] = loads(row.pop("subjects_json", "[]"), [])
            row["directions"] = loads(row.pop("directions_json", "[]"), [])
        return row

    def update_tutor_profile(self, workspace_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        allowed = {
            "first_name",
            "last_name",
            "photo_url",
            "description",
            "timezone",
            "experience_years",
            "hourly_price",
            "public_slug",
        }
        data = {key: value for key, value in payload.items() if key in allowed and value is not None}
        if "subjects" in payload:
            data["subjects_json"] = json.dumps(payload["subjects"], ensure_ascii=False)
        if "directions" in payload:
            data["directions_json"] = json.dumps(payload["directions"], ensure_ascii=False)
        data["updated_at"] = dt()
        assignments = ", ".join(f"{key} = ?" for key in data)
        self.conn.execute(
            f"UPDATE tutor_profiles SET {assignments} WHERE workspace_id = ?",
            (*data.values(), workspace_id),
        )
        if "public_slug" in data:
            self.conn.execute("UPDATE workspaces SET public_slug = ? WHERE id = ?", (data["public_slug"], workspace_id))
        self.conn.commit()
        return self.get_tutor_profile_by_workspace(workspace_id) or {}

    def create_telegram_link_token(self, user_id: int, minutes: int = 30) -> str:
        token = random_token(18)
        self.conn.execute(
            """
            INSERT INTO telegram_link_tokens(token, user_id, expires_at, created_at)
            VALUES (?, ?, datetime('now', ?), ?)
            """,
            (token, user_id, f"+{minutes} minutes", dt()),
        )
        self.conn.commit()
        return token

    def consume_telegram_link_token(
        self,
        token: str,
        *,
        telegram_id: int,
        telegram_username: str = "",
        first_name: str = "",
        last_name: str = "",
    ) -> dict[str, Any]:
        row = self.row(
            """
            SELECT * FROM telegram_link_tokens
            WHERE token = ? AND consumed_at IS NULL AND expires_at > datetime('now')
            """,
            (token,),
        )
        if row is None:
            raise ValueError("telegram_link_token_invalid")
        user = self.row("SELECT * FROM users WHERE id = ?", (row["user_id"],))
        if user is None:
            raise ValueError("user_not_found")
        self.conn.execute(
            """
            UPDATE users
            SET telegram_id = ?, telegram_username = ?,
                first_name = CASE WHEN first_name = '' THEN ? ELSE first_name END,
                last_name = CASE WHEN last_name = '' THEN ? ELSE last_name END
            WHERE id = ?
            """,
            (telegram_id, telegram_username, first_name, last_name, user["id"]),
        )
        self.conn.execute(
            "UPDATE telegram_link_tokens SET consumed_at = ? WHERE token = ?",
            (dt(), token),
        )
        self.conn.execute(
            """
            INSERT INTO notification_settings(user_id, telegram_enabled, email_enabled, updated_at)
            VALUES (?, 1, 1, ?)
            ON CONFLICT(user_id) DO UPDATE SET telegram_enabled = 1, updated_at = excluded.updated_at
            """,
            (user["id"], dt()),
        )
        self.conn.commit()
        return self.row("SELECT * FROM users WHERE id = ?", (user["id"],)) or user

    def enqueue_notification(
        self,
        *,
        workspace_id: int | None,
        user_id: int | None,
        telegram_id: int | None,
        channel: str,
        kind: str,
        title: str,
        body: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        cur = self.conn.execute(
            """
            INSERT INTO notification_outbox(
                workspace_id, user_id, telegram_id, channel, type, title, body,
                payload_json, scheduled_at, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workspace_id,
                user_id,
                telegram_id,
                channel,
                kind,
                title,
                body,
                json.dumps(payload or {}, ensure_ascii=False),
                dt(),
                dt(),
            ),
        )
        self.conn.commit()
        return self.row("SELECT * FROM notification_outbox WHERE id = ?", (cur.lastrowid,)) or {}

    def list_pending_notifications(self, channel: str = "telegram", limit: int = 50) -> list[dict[str, Any]]:
        rows = self.rows(
            """
            SELECT * FROM notification_outbox
            WHERE channel = ? AND status = 'pending' AND scheduled_at <= ?
            ORDER BY scheduled_at, id
            LIMIT ?
            """,
            (channel, dt(), limit),
        )
        for row in rows:
            row["payload"] = loads(row.pop("payload_json", "{}"), {})
        return rows

    def mark_notification_sent(self, notification_id: int, *, error: str = "") -> dict[str, Any]:
        status = "failed" if error else "sent"
        self.conn.execute(
            "UPDATE notification_outbox SET status = ?, sent_at = ?, error = ? WHERE id = ?",
            (status, dt(), error, notification_id),
        )
        self.conn.commit()
        return self.row("SELECT * FROM notification_outbox WHERE id = ?", (notification_id,)) or {}

    def create_subscription(self, workspace_id: int, plan_id: int) -> dict[str, Any]:
        now = utc_now()
        cur = self.conn.execute(
            """
            INSERT INTO subscriptions(
                workspace_id, plan_id, status, trial_ends_at, current_period_starts_at,
                current_period_ends_at, created_at
            )
            VALUES (?, ?, 'trialing', ?, ?, ?, ?)
            """,
            (
                workspace_id,
                plan_id,
                dt(now + timedelta(days=14)),
                dt(now),
                dt(now + timedelta(days=30)),
                dt(now),
            ),
        )
        return self.row("SELECT * FROM subscriptions WHERE id = ?", (cur.lastrowid,)) or {}

    def list_plans(self) -> list[dict[str, Any]]:
        plans = self.rows("SELECT * FROM platform_plans WHERE is_active = 1 ORDER BY monthly_price")
        for plan in plans:
            plan["limits"] = loads(plan.pop("limits_json", "{}"), {})
        return plans

    def set_workspace_plan(self, workspace_id: int, plan_code: str) -> dict[str, Any]:
        plan = self.row("SELECT * FROM platform_plans WHERE code = ? AND is_active = 1", (plan_code,))
        if plan is None:
            raise ValueError("plan_not_found")
        subscription = self.row(
            "SELECT * FROM subscriptions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1",
            (workspace_id,),
        )
        if subscription:
            self.conn.execute(
                """
                UPDATE subscriptions
                SET plan_id = ?, status = 'active', updated_at = ?
                WHERE id = ?
                """,
                (plan["id"], dt(), subscription["id"]),
            )
            subscription_id = subscription["id"]
        else:
            subscription_id = self.create_subscription(workspace_id, int(plan["id"]))["id"]
        self.conn.execute(
            "UPDATE workspaces SET plan_id = ?, subscription_id = ? WHERE id = ?",
            (plan["id"], subscription_id, workspace_id),
        )
        self.conn.execute(
            """
            INSERT INTO billing_events(workspace_id, subscription_id, type, amount, status, metadata_json, created_at)
            VALUES (?, ?, 'plan_changed', ?, 'succeeded', ?, ?)
            """,
            (
                workspace_id,
                subscription_id,
                int(plan["monthly_price"]),
                json.dumps({"plan_code": plan_code}, ensure_ascii=False),
                dt(),
            ),
        )
        self.conn.commit()
        return self.get_workspace(workspace_id) or {}

    def usage_for_workspace(self, workspace_id: int) -> dict[str, int]:
        return {
            "students": int(self.row("SELECT COUNT(*) AS c FROM students WHERE workspace_id = ?", (workspace_id,))["c"]),
            "teachers": int(self.row("SELECT COUNT(*) AS c FROM workspace_memberships WHERE workspace_id = ? AND role IN ('tutor', 'teacher')", (workspace_id,))["c"]),
            "files": int(self.row("SELECT COUNT(*) AS c FROM homework_submissions WHERE workspace_id = ?", (workspace_id,))["c"]),
            "active_lessons": int(self.row("SELECT COUNT(*) AS c FROM lessons WHERE workspace_id = ? AND status IN ('planned', 'pending_confirmation')", (workspace_id,))["c"]),
        }

    def enforce_limit(self, workspace_id: int, key: str, add: int = 1) -> None:
        workspace = self.get_workspace(workspace_id)
        if workspace is None:
            raise ValueError("workspace_not_found")
        limits = loads(workspace.get("limits_json"), {})
        limit = limits.get(key)
        if limit is None:
            return
        usage = self.usage_for_workspace(workspace_id).get(key, 0)
        if usage + add > int(limit):
            raise PermissionError(f"plan_limit_exceeded:{key}")

    def get_workspace(self, workspace_id: int) -> dict[str, Any] | None:
        return self.row(
            """
            SELECT w.*, p.code AS plan_code, p.name AS plan_name, p.limits_json
            FROM workspaces w
            LEFT JOIN platform_plans p ON p.id = w.plan_id
            WHERE w.id = ?
            """,
            (workspace_id,),
        )

    def get_membership(self, user_id: int, workspace_id: int) -> dict[str, Any] | None:
        return self.row(
            """
            SELECT * FROM workspace_memberships
            WHERE user_id = ? AND workspace_id = ?
            ORDER BY CASE role
                WHEN 'tutor' THEN 1
                WHEN 'teacher' THEN 2
                WHEN 'student' THEN 3
                WHEN 'parent' THEN 4
                ELSE 5
            END
            LIMIT 1
            """,
            (user_id, workspace_id),
        )

    def list_user_workspaces(self, user_id: int) -> list[dict[str, Any]]:
        return self.rows(
            """
            SELECT w.*, m.role, p.code AS plan_code
            FROM workspace_memberships m
            JOIN workspaces w ON w.id = m.workspace_id
            LEFT JOIN platform_plans p ON p.id = w.plan_id
            WHERE m.user_id = ?
            ORDER BY w.created_at DESC
            """,
            (user_id,),
        )

    def create_refresh_token(self, user_id: int, days: int) -> str:
        token = random_token(32)
        self.conn.execute(
            "INSERT INTO refresh_tokens(token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (token, user_id, dt(utc_now() + timedelta(days=days)), dt()),
        )
        self.conn.commit()
        return token

    def add_invite(self, workspace_id: int, role: str, created_by_user_id: int) -> dict[str, Any]:
        token = random_token(18)
        self.conn.execute(
            """
            INSERT INTO invitation_links(token, workspace_id, role, created_by_user_id, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (token, workspace_id, role, created_by_user_id, dt()),
        )
        self.conn.commit()
        return self.row("SELECT * FROM invitation_links WHERE token = ?", (token,)) or {}

    def create_student(self, workspace_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        self.enforce_limit(workspace_id, "students")
        cur = self.conn.execute(
            """
            INSERT INTO students(
                workspace_id, full_name, grade, timezone, subject, prep_type, goal,
                current_level, lesson_price, price_60, price_90, price_120,
                lesson_duration_minutes, balance_lessons, balance_money, progress_current,
                progress_goal, prep_plan_text, prep_plan_file_id, start_date, exam_date,
                student_telegram, parent_name, parent_telegram, parent_can_edit,
                board_url, meeting_url, comment, status, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workspace_id,
                payload.get("full_name", ""),
                payload.get("grade", ""),
                payload.get("timezone", "Europe/Moscow"),
                payload.get("subject", ""),
                payload.get("prep_type", ""),
                payload.get("goal", ""),
                payload.get("current_level", ""),
                int(payload.get("lesson_price") or 0),
                int(payload.get("price_60") or payload.get("lesson_price") or 0),
                int(payload.get("price_90") or round(int(payload.get("lesson_price") or 0) * 1.5)),
                int(payload.get("price_120") or int(payload.get("lesson_price") or 0) * 2),
                int(payload.get("lesson_duration_minutes") or 60),
                int(payload.get("balance_lessons") or 0),
                int(payload.get("balance_money") or 0),
                int(payload.get("progress_current") or 0),
                int(payload.get("progress_goal") or 0),
                payload.get("prep_plan_text", ""),
                payload.get("prep_plan_file_id", ""),
                payload.get("start_date"),
                payload.get("exam_date"),
                payload.get("student_telegram", ""),
                payload.get("parent_name", ""),
                payload.get("parent_telegram", ""),
                1 if payload.get("parent_can_edit") else 0,
                payload.get("board_url", ""),
                payload.get("meeting_url", ""),
                payload.get("comment", ""),
                payload.get("status", "active"),
                dt(),
            ),
        )
        self.conn.commit()
        return self.row("SELECT * FROM students WHERE id = ?", (cur.lastrowid,)) or {}

    def list_students(self, workspace_id: int) -> list[dict[str, Any]]:
        return self.rows("SELECT * FROM students WHERE workspace_id = ? ORDER BY full_name", (workspace_id,))

    def get_student(self, workspace_id: int, student_id: int) -> dict[str, Any] | None:
        return self.row("SELECT * FROM students WHERE workspace_id = ? AND id = ?", (workspace_id, student_id))

    def update_student(self, workspace_id: int, student_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        student = self.get_student(workspace_id, student_id)
        if student is None:
            raise ValueError("student_not_found")
        allowed = {
            "full_name",
            "grade",
            "timezone",
            "subject",
            "prep_type",
            "goal",
            "current_level",
            "lesson_price",
            "price_60",
            "price_90",
            "price_120",
            "lesson_duration_minutes",
            "balance_lessons",
            "balance_money",
            "progress_current",
            "progress_goal",
            "prep_plan_text",
            "prep_plan_file_id",
            "start_date",
            "exam_date",
            "status",
            "student_telegram",
            "parent_name",
            "parent_telegram",
            "parent_can_edit",
            "board_url",
            "meeting_url",
            "comment",
        }
        data = {key: value for key, value in payload.items() if key in allowed and value is not None}
        if not data:
            return student
        assignments = ", ".join(f"{key} = ?" for key in data)
        self.conn.execute(
            f"UPDATE students SET {assignments} WHERE workspace_id = ? AND id = ?",
            (*data.values(), workspace_id, student_id),
        )
        self.conn.commit()
        return self.get_student(workspace_id, student_id) or {}

    def add_lesson(self, workspace_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        if payload.get("status", LessonStatus.PLANNED.value) in {
            LessonStatus.PLANNED.value,
            LessonStatus.PENDING_CONFIRMATION.value,
        }:
            self.enforce_limit(workspace_id, "active_lessons")
        student = self.row(
            "SELECT * FROM students WHERE id = ? AND workspace_id = ?",
            (payload["student_id"], workspace_id),
        )
        if student is None:
            raise ValueError("student_not_found")
        amount = int(payload.get("payment_amount") or student["lesson_price"] or 0)
        cur = self.conn.execute(
            """
            INSERT INTO lessons(
                workspace_id, student_id, starts_at, duration_minutes, status,
                topic, next_plan, payment_status, payment_amount, notes, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workspace_id,
                payload["student_id"],
                payload["starts_at"],
                int(payload.get("duration_minutes") or 60),
                payload.get("status", LessonStatus.PLANNED.value),
                payload.get("topic", ""),
                payload.get("next_plan", ""),
                payload.get("payment_status", "not_paid"),
                amount,
                payload.get("notes", ""),
                dt(),
            ),
        )
        self.conn.commit()
        return self.row("SELECT * FROM lessons WHERE id = ?", (cur.lastrowid,)) or {}

    def list_lessons(self, workspace_id: int, student_id: int | None = None, limit: int = 200) -> list[dict[str, Any]]:
        if student_id is None:
            return self.rows(
                "SELECT * FROM lessons WHERE workspace_id = ? ORDER BY starts_at LIMIT ?",
                (workspace_id, limit),
            )
        return self.rows(
            "SELECT * FROM lessons WHERE workspace_id = ? AND student_id = ? ORDER BY starts_at LIMIT ?",
            (workspace_id, student_id, limit),
        )

    def get_lesson(self, workspace_id: int, lesson_id: int) -> dict[str, Any] | None:
        return self.row("SELECT * FROM lessons WHERE workspace_id = ? AND id = ?", (workspace_id, lesson_id))

    def update_lesson(self, workspace_id: int, lesson_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        lesson = self.get_lesson(workspace_id, lesson_id)
        if lesson is None:
            raise ValueError("lesson_not_found")
        allowed = {
            "student_id",
            "starts_at",
            "duration_minutes",
            "status",
            "topic",
            "next_plan",
            "cancellation_reason",
            "cancelled_by",
            "payment_status",
            "payment_marked_by",
            "payment_confirmed_at",
            "payment_amount",
            "notes",
        }
        data = {key: value for key, value in payload.items() if key in allowed and value is not None}
        if not data:
            return lesson
        assignments = ", ".join(f"{key} = ?" for key in data)
        self.conn.execute(
            f"UPDATE lessons SET {assignments} WHERE workspace_id = ? AND id = ?",
            (*data.values(), workspace_id, lesson_id),
        )
        self.conn.commit()
        return self.get_lesson(workspace_id, lesson_id) or {}

    def delete_lesson(self, workspace_id: int, lesson_id: int) -> None:
        self.conn.execute("DELETE FROM lessons WHERE workspace_id = ? AND id = ?", (workspace_id, lesson_id))
        self.conn.commit()

    def list_homeworks(self, workspace_id: int, student_id: int | None = None, limit: int = 200) -> list[dict[str, Any]]:
        if student_id is None:
            return self.rows(
                "SELECT * FROM homeworks WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
                (workspace_id, limit),
            )
        return self.rows(
            "SELECT * FROM homeworks WHERE workspace_id = ? AND student_id = ? ORDER BY created_at DESC LIMIT ?",
            (workspace_id, student_id, limit),
        )

    def list_payments(self, workspace_id: int, student_id: int | None = None, limit: int = 200) -> list[dict[str, Any]]:
        if student_id is None:
            return self.rows(
                "SELECT * FROM payments WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
                (workspace_id, limit),
            )
        return self.rows(
            "SELECT * FROM payments WHERE workspace_id = ? AND student_id = ? ORDER BY created_at DESC LIMIT ?",
            (workspace_id, student_id, limit),
        )

    def add_homework(self, workspace_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        student = self.get_student(workspace_id, int(payload["student_id"]))
        if student is None:
            raise ValueError("student_not_found")
        cur = self.conn.execute(
            """
            INSERT INTO homeworks(
                workspace_id, student_id, title, text, deadline, status, materials_json,
                links_json, teacher_comment, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workspace_id,
                payload["student_id"],
                payload.get("title", ""),
                payload.get("text", ""),
                payload.get("deadline"),
                payload.get("status", "ожидание выполнения"),
                json.dumps(payload.get("attachments") or payload.get("materials") or [], ensure_ascii=False),
                json.dumps(payload.get("links") or [], ensure_ascii=False),
                payload.get("teacher_comment", ""),
                dt(),
                dt(),
            ),
        )
        self.conn.commit()
        return self.row("SELECT * FROM homeworks WHERE id = ?", (cur.lastrowid,)) or {}

    def update_homework(self, workspace_id: int, homework_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        homework = self.row("SELECT * FROM homeworks WHERE workspace_id = ? AND id = ?", (workspace_id, homework_id))
        if homework is None:
            raise ValueError("homework_not_found")
        mapping = {
            "title": payload.get("title"),
            "text": payload.get("text"),
            "deadline": payload.get("deadline"),
            "status": payload.get("status"),
            "materials_json": json.dumps(payload["attachments"], ensure_ascii=False) if "attachments" in payload else None,
            "links_json": json.dumps(payload["links"], ensure_ascii=False) if "links" in payload else None,
            "teacher_comment": payload.get("teacher_comment"),
            "updated_at": dt(),
        }
        data = {key: value for key, value in mapping.items() if value is not None}
        assignments = ", ".join(f"{key} = ?" for key in data)
        self.conn.execute(
            f"UPDATE homeworks SET {assignments} WHERE workspace_id = ? AND id = ?",
            (*data.values(), workspace_id, homework_id),
        )
        self.conn.commit()
        return self.row("SELECT * FROM homeworks WHERE id = ?", (homework_id,)) or {}

    def delete_homework(self, workspace_id: int, homework_id: int) -> None:
        self.conn.execute("DELETE FROM homeworks WHERE workspace_id = ? AND id = ?", (workspace_id, homework_id))
        self.conn.commit()

    def list_prep_topics(self, workspace_id: int, student_id: int) -> list[dict[str, Any]]:
        return self.rows(
            "SELECT * FROM prep_topics WHERE workspace_id = ? AND student_id = ? ORDER BY title",
            (workspace_id, student_id),
        )

    def upsert_prep_topic(self, workspace_id: int, student_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        title = payload.get("title") or f"Задание {payload.get('task_number')}"
        existing = self.row(
            "SELECT * FROM prep_topics WHERE workspace_id = ? AND student_id = ? AND title = ?",
            (workspace_id, student_id, title),
        )
        level = int(payload.get("knowledge_level") or existing["knowledge_level"] if existing else payload.get("knowledge_level") or 0)
        status = payload.get("status") or ("уверенно решает" if level >= 8 else "нужно повторить" if level >= 5 else "проблемная тема" if level else "не начинали")
        if existing:
            self.conn.execute(
                """
                UPDATE prep_topics SET knowledge_level = ?, status = ?, solved_count = ?, comment = ?
                WHERE id = ?
                """,
                (
                    level,
                    status,
                    int(payload.get("solved_count") or existing["solved_count"] or 0),
                    payload.get("comment", existing["comment"]),
                    existing["id"],
                ),
            )
            topic_id = existing["id"]
        else:
            cur = self.conn.execute(
                """
                INSERT INTO prep_topics(workspace_id, student_id, title, status, solved_count, knowledge_level, comment)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    workspace_id,
                    student_id,
                    title,
                    status,
                    int(payload.get("solved_count") or 0),
                    level,
                    payload.get("comment", ""),
                ),
            )
            topic_id = cur.lastrowid
        self.conn.commit()
        return self.row("SELECT * FROM prep_topics WHERE id = ?", (topic_id,)) or {}

    def list_plan_items(self, workspace_id: int, student_id: int) -> list[dict[str, Any]]:
        return self.rows(
            "SELECT * FROM plan_items WHERE workspace_id = ? AND student_id = ? ORDER BY position, id",
            (workspace_id, student_id),
        )

    def add_plan_item(self, workspace_id: int, student_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        current = self.list_plan_items(workspace_id, student_id)
        cur = self.conn.execute(
            """
            INSERT INTO plan_items(workspace_id, student_id, title, position, status, comment, deadline)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workspace_id,
                student_id,
                payload.get("title", ""),
                int(payload.get("position") or (max([item["position"] for item in current], default=0) + 1)),
                payload.get("status", "не начато"),
                payload.get("comment", ""),
                payload.get("deadline"),
            ),
        )
        self.conn.commit()
        return self.row("SELECT * FROM plan_items WHERE id = ?", (cur.lastrowid,)) or {}

    def update_plan_item(self, workspace_id: int, student_id: int, item_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        item = self.row(
            "SELECT * FROM plan_items WHERE workspace_id = ? AND student_id = ? AND id = ?",
            (workspace_id, student_id, item_id),
        )
        if item is None:
            raise ValueError("plan_item_not_found")
        data = {key: value for key, value in payload.items() if key in {"title", "deadline", "comment", "status"} and value is not None}
        if data:
            assignments = ", ".join(f"{key} = ?" for key in data)
            self.conn.execute(
                f"UPDATE plan_items SET {assignments} WHERE workspace_id = ? AND student_id = ? AND id = ?",
                (*data.values(), workspace_id, student_id, item_id),
            )
            self.conn.commit()
        return self.row("SELECT * FROM plan_items WHERE id = ?", (item_id,)) or {}

    def delete_progress_note(self, workspace_id: int, student_id: int, topic_id: int) -> None:
        self.conn.execute(
            "UPDATE prep_topics SET comment = '' WHERE workspace_id = ? AND student_id = ? AND id = ?",
            (workspace_id, student_id, topic_id),
        )
        self.conn.commit()

    def delete_student(self, workspace_id: int, student_id: int) -> None:
        self.conn.execute("DELETE FROM students WHERE workspace_id = ? AND id = ?", (workspace_id, student_id))
        self.conn.commit()

    def mark_lesson_conducted(self, workspace_id: int, lesson_id: int) -> dict[str, Any]:
        lesson = self.row("SELECT * FROM lessons WHERE id = ? AND workspace_id = ?", (lesson_id, workspace_id))
        if lesson is None:
            raise ValueError("lesson_not_found")
        student = self.row("SELECT * FROM students WHERE id = ?", (lesson["student_id"],))
        if student is None:
            raise ValueError("student_not_found")
        balance_lessons = int(student["balance_lessons"])
        payment_status = "unpaid"
        lessons_delta = 0
        if balance_lessons > 0:
            balance_lessons -= 1
            lessons_delta = -1
            payment_status = "paid_by_prepayment"
        self.conn.execute(
            "UPDATE students SET balance_lessons = ? WHERE id = ?",
            (balance_lessons, student["id"]),
        )
        self.conn.execute(
            "UPDATE lessons SET status = ?, payment_status = ? WHERE id = ?",
            (LessonStatus.CONDUCTED.value, payment_status, lesson_id),
        )
        if lessons_delta:
            self.conn.execute(
                """
                INSERT INTO finance_operations(
                    workspace_id, student_id, lesson_id, type, amount, lessons_delta,
                    balance_lessons_after, balance_money_after, description, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    workspace_id,
                    student["id"],
                    lesson_id,
                    FinanceOperationType.AUTO_LESSON_CHARGE.value,
                    int(lesson["payment_amount"]),
                    lessons_delta,
                    balance_lessons,
                    int(student["balance_money"]),
                    "Автоматическое списание предоплаченного занятия",
                    dt(),
                ),
            )
        self.conn.commit()
        return self.row("SELECT * FROM lessons WHERE id = ?", (lesson_id,)) or {}

    def add_payment(self, workspace_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        student = self.row(
            "SELECT * FROM students WHERE id = ? AND workspace_id = ?",
            (payload["student_id"], workspace_id),
        )
        if student is None:
            raise ValueError("student_not_found")
        status = payload.get("status", "confirmed")
        lessons_count = int(payload.get("lessons_count") or 0)
        amount = int(payload.get("amount") or 0)
        balance_lessons = int(student["balance_lessons"])
        if status == "confirmed" and lessons_count:
            balance_lessons += lessons_count
        cur = self.conn.execute(
            """
            INSERT INTO payments(workspace_id, student_id, amount, lessons_count, status, comment, created_at, confirmed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                workspace_id,
                student["id"],
                amount,
                lessons_count,
                status,
                payload.get("comment", ""),
                dt(),
                dt() if status == "confirmed" else None,
            ),
        )
        payment_id = int(cur.lastrowid)
        self.conn.execute("UPDATE students SET balance_lessons = ? WHERE id = ?", (balance_lessons, student["id"]))
        if status == "confirmed":
            op_type = FinanceOperationType.PREPAYMENT.value if lessons_count else FinanceOperationType.MANUAL_PAYMENT.value
            self.conn.execute(
                """
                INSERT INTO finance_operations(
                    workspace_id, student_id, payment_id, type, amount, lessons_delta,
                    balance_lessons_after, balance_money_after, description, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    workspace_id,
                    student["id"],
                    payment_id,
                    op_type,
                    amount,
                    lessons_count,
                    balance_lessons,
                    int(student["balance_money"]),
                    payload.get("comment", "Оплата"),
                    dt(),
                ),
            )
        self.conn.commit()
        return self.row("SELECT * FROM payments WHERE id = ?", (payment_id,)) or {}

    def dashboard(self, workspace_id: int) -> dict[str, Any]:
        now = utc_now()
        today = now.date().isoformat()
        week_end = (now + timedelta(days=7)).isoformat()
        month_end = (now + timedelta(days=30)).isoformat()
        student_count = self.row("SELECT COUNT(*) AS c FROM students WHERE workspace_id = ?", (workspace_id,))["c"]
        today_lessons = self.row(
            "SELECT COUNT(*) AS c FROM lessons WHERE workspace_id = ? AND starts_at LIKE ?",
            (workspace_id, f"{today}%"),
        )["c"]
        expected_week = self.row(
            """
            SELECT COALESCE(SUM(payment_amount), 0) AS s FROM lessons
            WHERE workspace_id = ? AND starts_at >= ? AND starts_at < ? AND status IN ('planned', 'pending_confirmation')
            """,
            (workspace_id, now.isoformat(), week_end),
        )["s"]
        expected_month = self.row(
            """
            SELECT COALESCE(SUM(payment_amount), 0) AS s FROM lessons
            WHERE workspace_id = ? AND starts_at >= ? AND starts_at < ? AND status IN ('planned', 'pending_confirmation')
            """,
            (workspace_id, now.isoformat(), month_end),
        )["s"]
        unpaid = self.row(
            "SELECT COUNT(*) AS c FROM lessons WHERE workspace_id = ? AND status = 'conducted' AND payment_status IN ('unpaid', 'not_paid')",
            (workspace_id,),
        )["c"]
        return {
            "student_count": student_count,
            "lessons_today": today_lessons,
            "expected_week": expected_week,
            "expected_month": expected_month,
            "unpaid_lessons": unpaid,
            "latest_payments": self.rows(
                "SELECT * FROM payments WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 5",
                (workspace_id,),
            ),
            "upcoming_lessons": self.rows(
                "SELECT * FROM lessons WHERE workspace_id = ? AND starts_at >= ? ORDER BY starts_at LIMIT 8",
                (workspace_id, now.isoformat()),
            ),
            "new_homeworks": self.rows(
                "SELECT * FROM homeworks WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 8",
                (workspace_id,),
            ),
        }

    def public_profile(self, slug: str) -> dict[str, Any] | None:
        row = self.row(
            """
            SELECT tp.*, w.id AS workspace_id, w.public_slug AS workspace_public_slug,
                   wl.custom_domain, wl.logo_url, wl.colors_json
            FROM tutor_profiles tp
            JOIN workspaces w ON w.id = tp.workspace_id
            LEFT JOIN white_label_settings wl ON wl.workspace_id = w.id
            WHERE tp.public_slug = ? OR w.public_slug = ?
            """,
            (slug, slug),
        )
        if row:
            row["subjects"] = loads(row.pop("subjects_json", "[]"), [])
            row["directions"] = loads(row.pop("directions_json", "[]"), [])
            row["colors"] = loads(row.pop("colors_json", "{}"), {})
            row["free_slots"] = self.rows(
                """
                SELECT starts_at, duration_minutes FROM lessons
                WHERE workspace_id = ? AND status = 'planned' AND starts_at >= ?
                ORDER BY starts_at LIMIT 8
                """,
                (row["workspace_id"], utc_now().isoformat()),
            )
        return row

    def add_application(self, slug: str, payload: dict[str, Any]) -> dict[str, Any]:
        profile = self.public_profile(slug)
        if profile is None:
            raise ValueError("profile_not_found")
        cur = self.conn.execute(
            """
            INSERT INTO applications(workspace_id, tutor_profile_id, student_name, contact, selected_slot, comment, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                profile["workspace_id"],
                profile["workspace_id"],
                payload.get("student_name", ""),
                payload.get("contact", ""),
                payload.get("selected_slot", ""),
                payload.get("comment", ""),
                dt(),
            ),
        )
        self.conn.commit()
        return self.row("SELECT * FROM applications WHERE id = ?", (cur.lastrowid,)) or {}

    def import_legacy(self, legacy_path: str | Path, *, owner_email: str, first_name: str, last_name: str, slug: str) -> dict[str, Any]:
        legacy = Path(legacy_path)
        if not legacy.exists():
            return {"imported": False, "reason": "legacy_database_missing"}
        if self.row("SELECT * FROM workspaces WHERE slug = ?", (slug,)):
            return {"imported": False, "reason": "workspace_exists"}

        owner = self.create_or_get_user(email=owner_email, first_name=first_name, last_name=last_name)
        workspace = self.create_workspace(
            owner_user_id=int(owner["id"]),
            slug=slug,
            name=f"Кабинет {first_name}".strip(),
            public_slug=slug,
            first_name=first_name,
            last_name=last_name,
            description="Перенесенный кабинет из Telegram Mini App.",
            subjects=["Математика", "Информатика"],
            directions=["ЕГЭ", "ОГЭ", "Школьная программа"],
        )
        legacy_conn = sqlite3.connect(legacy)
        legacy_conn.row_factory = sqlite3.Row
        student_map: dict[int, int] = {}
        for row in legacy_conn.execute("SELECT * FROM students").fetchall():
            student = self.create_student(
                int(workspace["id"]),
                {
                    "full_name": row["full_name"],
                    "grade": row["grade"],
                    "timezone": row["timezone"] if "timezone" in row.keys() else "Europe/Moscow",
                    "subject": row["subject"],
                    "prep_type": row["prep_type"],
                    "goal": row["goal"],
                    "current_level": row["current_level"] if "current_level" in row.keys() else "",
                    "lesson_price": row["lesson_price"],
                    "price_60": row["price_60"] if "price_60" in row.keys() else row["lesson_price"],
                    "price_90": row["price_90"] if "price_90" in row.keys() else round(row["lesson_price"] * 1.5),
                    "price_120": row["price_120"] if "price_120" in row.keys() else row["lesson_price"] * 2,
                    "lesson_duration_minutes": row["lesson_duration_minutes"] if "lesson_duration_minutes" in row.keys() else 60,
                    "balance_lessons": row["balance_lessons"],
                    "balance_money": row["balance_money"] if "balance_money" in row.keys() else 0,
                    "progress_current": row["progress_current"] if "progress_current" in row.keys() else 0,
                    "progress_goal": row["progress_goal"] if "progress_goal" in row.keys() else 0,
                    "prep_plan_text": row["prep_plan_text"] if "prep_plan_text" in row.keys() else "",
                    "prep_plan_file_id": row["prep_plan_file_id"] if "prep_plan_file_id" in row.keys() else "",
                    "start_date": row["start_date"] if "start_date" in row.keys() else None,
                    "exam_date": row["exam_date"] if "exam_date" in row.keys() else None,
                    "student_telegram": row["student_telegram"],
                    "parent_name": row["parent_name"],
                    "parent_telegram": row["parent_telegram"],
                    "parent_can_edit": bool(row["parent_can_edit"]) if "parent_can_edit" in row.keys() else False,
                    "board_url": row["board_url"],
                    "meeting_url": row["meeting_url"],
                    "comment": row["comment"],
                    "status": row["status"],
                },
            )
            self.conn.execute(
                "UPDATE students SET legacy_id = ?, created_at = ? WHERE id = ?",
                (row["id"], row["created_at"], student["id"]),
            )
            student_map[int(row["id"])] = int(student["id"])

        lesson_map: dict[int, int] = {}
        for row in legacy_conn.execute("SELECT * FROM lessons").fetchall():
            student_id = student_map.get(int(row["student_id"]))
            if not student_id:
                continue
            cur = self.conn.execute(
                """
                INSERT INTO lessons(
                    workspace_id, student_id, legacy_id, starts_at, duration_minutes,
                    status, topic, payment_status, payment_amount, notes, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    workspace["id"],
                    student_id,
                    row["id"],
                    row["starts_at"],
                    row["duration_minutes"],
                    row["status"],
                    row["topic"],
                    row["payment_status"] if "payment_status" in row.keys() else "not_paid",
                    row["payment_amount"] if "payment_amount" in row.keys() else 0,
                    row["notes"] if "notes" in row.keys() else "",
                    row["created_at"],
                ),
            )
            self.conn.execute(
                """
                UPDATE lessons
                SET next_plan = ?, cancellation_reason = ?, cancelled_by = ?, stable_series_id = ?,
                    payment_marked_by = ?, payment_confirmed_at = ?
                WHERE id = ?
                """,
                (
                    row["next_plan"] if "next_plan" in row.keys() else "",
                    row["cancellation_reason"] if "cancellation_reason" in row.keys() else "",
                    row["cancelled_by"] if "cancelled_by" in row.keys() else "",
                    row["stable_series_id"] if "stable_series_id" in row.keys() else "",
                    row["payment_marked_by"] if "payment_marked_by" in row.keys() else "",
                    row["payment_confirmed_at"] if "payment_confirmed_at" in row.keys() else None,
                    cur.lastrowid,
                ),
            )
            lesson_map[int(row["id"])] = int(cur.lastrowid)

        for row in legacy_conn.execute("SELECT * FROM payments").fetchall():
            student_id = student_map.get(int(row["student_id"]))
            if not student_id:
                continue
            lesson_id = lesson_map.get(int(row["lesson_id"])) if "lesson_id" in row.keys() and row["lesson_id"] else None
            cur = self.conn.execute(
                """
                INSERT INTO payments(
                    workspace_id, student_id, lesson_id, legacy_id, amount, lessons_count,
                    status, comment, created_at, confirmed_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    workspace["id"],
                    student_id,
                    lesson_id,
                    row["id"],
                    row["amount"],
                    row["lessons_count"],
                    row["status"],
                    row["comment"],
                    row["created_at"],
                    row["confirmed_at"],
                ),
            )
            if row["status"] == "подтверждено":
                self.conn.execute(
                    """
                    INSERT INTO finance_operations(
                        workspace_id, student_id, lesson_id, payment_id, type, amount,
                        lessons_delta, description, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        workspace["id"],
                        student_id,
                        lesson_id,
                        cur.lastrowid,
                        FinanceOperationType.PREPAYMENT.value if row["lessons_count"] else FinanceOperationType.MANUAL_PAYMENT.value,
                        row["amount"],
                        row["lessons_count"],
                        row["comment"],
                        row["confirmed_at"] or row["created_at"],
                    ),
                )

        for row in legacy_conn.execute("SELECT * FROM homeworks").fetchall():
            student_id = student_map.get(int(row["student_id"]))
            if not student_id:
                continue
            self.conn.execute(
                """
                INSERT INTO homeworks(
                    workspace_id, student_id, legacy_id, title, text, deadline, status,
                    materials_json, links_json, teacher_comment, created_at, updated_at, checked_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    workspace["id"],
                    student_id,
                    row["id"],
                    row["title"] if "title" in row.keys() else "",
                    row["text"],
                    row["deadline"],
                    row["status"],
                    row["materials_json"],
                    row["links_json"] if "links_json" in row.keys() else "[]",
                    row["teacher_comment"],
                    row["created_at"],
                    row["updated_at"] if "updated_at" in row.keys() else None,
                    row["checked_at"],
                ),
            )
        for row in legacy_conn.execute("SELECT * FROM prep_topics").fetchall():
            student_id = student_map.get(int(row["student_id"]))
            if not student_id:
                continue
            self.conn.execute(
                """
                INSERT INTO prep_topics(
                    workspace_id, student_id, legacy_id, title, status, solved_count, knowledge_level, comment
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    workspace["id"],
                    student_id,
                    row["id"],
                    row["title"],
                    row["status"],
                    row["solved_count"],
                    row["knowledge_level"] if "knowledge_level" in row.keys() else 0,
                    row["comment"],
                ),
            )
        for row in legacy_conn.execute("SELECT * FROM plan_items").fetchall():
            student_id = student_map.get(int(row["student_id"]))
            if not student_id:
                continue
            self.conn.execute(
                """
                INSERT INTO plan_items(
                    workspace_id, student_id, legacy_id, title, position, status, comment, deadline
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    workspace["id"],
                    student_id,
                    row["id"],
                    row["title"],
                    row["position"],
                    row["status"],
                    row["comment"],
                    row["deadline"] if "deadline" in row.keys() else None,
                ),
            )
        for row in legacy_conn.execute("SELECT * FROM schedule_rules").fetchall():
            student_id = student_map.get(int(row["student_id"]))
            if not student_id:
                continue
            self.conn.execute(
                """
                INSERT INTO schedule_rules(
                    workspace_id, student_id, legacy_id, weekdays_json, lesson_time,
                    duration_minutes, starts_at, ends_at, is_active, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    workspace["id"],
                    student_id,
                    row["id"],
                    row["weekdays_json"],
                    row["lesson_time"],
                    row["duration_minutes"],
                    row["starts_at"],
                    row["ends_at"],
                    row["is_active"],
                    row["created_at"],
                ),
            )
        self.conn.commit()
        legacy_conn.close()
        return {
            "imported": True,
            "workspace_id": workspace["id"],
            "students": len(student_map),
            "lessons": len(lesson_map),
        }
