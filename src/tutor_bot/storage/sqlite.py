from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from tutor_bot.domain.enums import HomeworkStatus, LessonStatus, PaymentStatus, StudentStatus
from tutor_bot.domain.models import (
    ClosedSlot,
    Homework,
    HomeworkSubmission,
    Lesson,
    Payment,
    PlanItem,
    PrepTopic,
    ScheduleRule,
    StudentProfile,
    UserAccount,
)

RECENT_DUPLICATE_SECONDS = 10 * 60
OLD_CONFIRMED_LESSON_PAYMENT_STATUS = "подтверждено репетитором"


def utc_now() -> datetime:
    return datetime.now(UTC)


def _dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _date(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _parse_dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _parse_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


class SQLiteStorage:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.init_schema()

    def close(self) -> None:
        self.conn.close()

    def init_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                grade TEXT NOT NULL DEFAULT '',
                prep_type TEXT NOT NULL DEFAULT '',
                subject TEXT NOT NULL DEFAULT '',
                goal TEXT NOT NULL DEFAULT '',
                current_level TEXT NOT NULL DEFAULT '',
                lesson_price INTEGER NOT NULL DEFAULT 0,
                price_60 INTEGER NOT NULL DEFAULT 0,
                price_90 INTEGER NOT NULL DEFAULT 0,
                price_120 INTEGER NOT NULL DEFAULT 0,
                lesson_duration_minutes INTEGER NOT NULL DEFAULT 60,
                lesson_format TEXT NOT NULL DEFAULT '',
                board_url TEXT NOT NULL DEFAULT '',
                meeting_url TEXT NOT NULL DEFAULT '',
                student_telegram TEXT NOT NULL DEFAULT '',
                parent_telegram TEXT NOT NULL DEFAULT '',
                parent_name TEXT NOT NULL DEFAULT '',
                payer TEXT NOT NULL DEFAULT '',
                timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
                preferred_days_times TEXT NOT NULL DEFAULT '',
                start_date TEXT,
                exam_date TEXT,
                comment TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'анкета',
                balance_mode TEXT NOT NULL DEFAULT 'lessons',
                balance_lessons INTEGER NOT NULL DEFAULT 0,
                balance_money INTEGER NOT NULL DEFAULT 0,
                progress_current INTEGER NOT NULL DEFAULT 0,
                progress_goal INTEGER NOT NULL DEFAULT 0,
                mock_tasks_solved INTEGER NOT NULL DEFAULT 0,
                mock_tasks_total INTEGER NOT NULL DEFAULT 0,
                mock_score INTEGER NOT NULL DEFAULT 0,
                mock_date TEXT,
                prep_plan_text TEXT NOT NULL DEFAULT '',
                prep_plan_file_id TEXT NOT NULL DEFAULT '',
                debt_reminder_sent_on TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_accounts (
                telegram_id INTEGER PRIMARY KEY,
                role TEXT NOT NULL,
                student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
                username TEXT NOT NULL DEFAULT '',
                full_name TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS browser_invites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_hash TEXT NOT NULL UNIQUE,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                session_days INTEGER NOT NULL DEFAULT 180,
                created_by INTEGER,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                used_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_browser_invites_token ON browser_invites(token_hash);
            CREATE INDEX IF NOT EXISTS idx_browser_invites_student ON browser_invites(student_id);

            CREATE TABLE IF NOT EXISTS browser_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_hash TEXT NOT NULL UNIQUE,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                last_seen_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_browser_sessions_token ON browser_sessions(token_hash);
            CREATE INDEX IF NOT EXISTS idx_browser_sessions_student ON browser_sessions(student_id);

            CREATE TABLE IF NOT EXISTS tutor_browser_invites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_hash TEXT NOT NULL UNIQUE,
                session_days INTEGER NOT NULL DEFAULT 180,
                created_by INTEGER,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                used_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_tutor_browser_invites_token ON tutor_browser_invites(token_hash);

            CREATE TABLE IF NOT EXISTS tutor_browser_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token_hash TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                last_seen_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_tutor_browser_sessions_token ON tutor_browser_sessions(token_hash);

            CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                starts_at TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'запланировано',
                topic TEXT NOT NULL DEFAULT '',
                homework_id INTEGER,
                charged INTEGER NOT NULL DEFAULT 0,
                cancellation_reason TEXT NOT NULL DEFAULT '',
                cancelled_by TEXT NOT NULL DEFAULT '',
                next_plan TEXT NOT NULL DEFAULT '',
                stable_series_id TEXT NOT NULL DEFAULT '',
                reminder_sent_at TEXT,
                payment_status TEXT NOT NULL DEFAULT 'не отмечено',
                payment_marked_by TEXT NOT NULL DEFAULT '',
                payment_confirmed_at TEXT,
                payment_amount INTEGER NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_lessons_starts_at ON lessons(starts_at);
            CREATE INDEX IF NOT EXISTS idx_lessons_student ON lessons(student_id);

            CREATE TABLE IF NOT EXISTS closed_slots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                starts_at TEXT NOT NULL,
                ends_at TEXT NOT NULL,
                reason TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_closed_slots_range ON closed_slots(starts_at, ends_at);

            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                amount INTEGER NOT NULL DEFAULT 0,
                lessons_count INTEGER NOT NULL DEFAULT 0,
                sender_role TEXT NOT NULL,
                sender_telegram_id INTEGER,
                lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
                receipt_file_id TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'ожидает подтверждения',
                comment TEXT NOT NULL DEFAULT '',
                balance_after_lessons INTEGER,
                balance_after_money INTEGER,
                created_at TEXT NOT NULL,
                confirmed_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);

            CREATE TABLE IF NOT EXISTS homeworks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                title TEXT NOT NULL DEFAULT '',
                text TEXT NOT NULL,
                estimated_minutes INTEGER NOT NULL DEFAULT 0,
                deadline TEXT,
                status TEXT NOT NULL DEFAULT 'выдано',
                materials_json TEXT NOT NULL DEFAULT '[]',
                links_json TEXT NOT NULL DEFAULT '[]',
                teacher_comment TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT,
                checked_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_homeworks_student ON homeworks(student_id);

            CREATE TABLE IF NOT EXISTS homework_submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                homework_id INTEGER NOT NULL REFERENCES homeworks(id) ON DELETE CASCADE,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                content TEXT NOT NULL DEFAULT '',
                file_ids_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS prep_topics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'не начинали',
                solved_count INTEGER NOT NULL DEFAULT 0,
                knowledge_level INTEGER NOT NULL DEFAULT 0,
                comment TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS plan_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'не начато',
                comment TEXT NOT NULL DEFAULT '',
                deadline TEXT
            );

            CREATE TABLE IF NOT EXISTS schedule_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                weekdays_json TEXT NOT NULL DEFAULT '[]',
                lesson_time TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL DEFAULT 60,
                starts_at TEXT,
                ends_at TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_schedule_rules_student ON schedule_rules(student_id);

            CREATE TABLE IF NOT EXISTS tutor_profile (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                full_name TEXT NOT NULL DEFAULT '',
                experience TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                subjects_json TEXT NOT NULL DEFAULT '[]',
                prep_types_json TEXT NOT NULL DEFAULT '[]',
                working_days_json TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,7]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS service_access (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                status TEXT NOT NULL DEFAULT 'active',
                message TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );
            """
        )
        self.conn.commit()
        self._ensure_column("lessons", "reminder_sent_at", "TEXT")
        self._ensure_column("lessons", "post_lesson_reminder_sent_at", "TEXT")
        self._ensure_column("lessons", "payment_status", "TEXT NOT NULL DEFAULT 'не отмечено'")
        self._ensure_column("lessons", "payment_marked_by", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("lessons", "payment_confirmed_at", "TEXT")
        self._ensure_column("lessons", "payment_amount", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("lessons", "notes", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("payments", "lesson_id", "INTEGER REFERENCES lessons(id) ON DELETE SET NULL")
        self._ensure_column("homeworks", "title", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("homeworks", "estimated_minutes", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("homeworks", "links_json", "TEXT NOT NULL DEFAULT '[]'")
        self._ensure_column("homeworks", "updated_at", "TEXT")
        self._ensure_column("students", "price_60", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("students", "price_90", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("students", "price_120", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("students", "timezone", "TEXT NOT NULL DEFAULT 'Europe/Moscow'")
        self._ensure_column("students", "parent_can_edit", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("students", "progress_current", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("students", "progress_goal", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("students", "mock_tasks_solved", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("students", "mock_tasks_total", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("students", "mock_score", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("students", "mock_date", "TEXT")
        self._ensure_column("students", "prep_plan_text", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("students", "prep_plan_file_id", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("students", "debt_reminder_sent_on", "TEXT")
        self._ensure_column("prep_topics", "knowledge_level", "INTEGER NOT NULL DEFAULT 0")
        self._ensure_column("plan_items", "deadline", "TEXT")
        self._ensure_column("tutor_profile", "full_name", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("tutor_profile", "experience", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("tutor_profile", "description", "TEXT NOT NULL DEFAULT ''")
        self._ensure_column("tutor_profile", "prep_types_json", "TEXT NOT NULL DEFAULT '[]'")
        self._ensure_column("tutor_profile", "working_days_json", "TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,7]'")
        self._ensure_tutor_profile()
        self._ensure_service_access()
        self._migrate_payment_status_labels()
        self._backfill_duration_prices()
        self._backfill_progress_goals()

    def _ensure_column(self, table: str, column: str, definition: str) -> None:
        columns = {
            row["name"] for row in self.conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if column not in columns:
            self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            self.conn.commit()

    def _ensure_service_access(self) -> None:
        now = _dt(utc_now())
        self.conn.execute(
            """
            INSERT OR IGNORE INTO service_access(id, status, message, updated_at)
            VALUES (1, 'active', '', ?)
            """,
            (now,),
        )
        self.conn.commit()

    def get_service_access(self) -> dict[str, Any]:
        row = self.conn.execute("SELECT * FROM service_access WHERE id = 1").fetchone()
        if not row:
            self._ensure_service_access()
            row = self.conn.execute("SELECT * FROM service_access WHERE id = 1").fetchone()
        return dict(row)

    def set_service_access(self, status: str, message: str = "") -> None:
        self.conn.execute(
            """
            INSERT INTO service_access(id, status, message, updated_at)
            VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET status = excluded.status, message = excluded.message, updated_at = excluded.updated_at
            """,
            (status, message, _dt(utc_now())),
        )
        self.conn.commit()

    def _backfill_duration_prices(self) -> None:
        self.conn.execute(
            """
            UPDATE students
            SET
                price_60 = CASE WHEN price_60 = 0 THEN lesson_price ELSE price_60 END,
                price_90 = CASE WHEN price_90 = 0 THEN ROUND(lesson_price * 1.5) ELSE price_90 END,
                price_120 = CASE WHEN price_120 = 0 THEN lesson_price * 2 ELSE price_120 END
            WHERE lesson_price > 0
            """
        )
        self.conn.commit()

    def _backfill_progress_goals(self) -> None:
        self.conn.execute(
            """
            UPDATE students
            SET progress_goal = CASE
                WHEN prep_type LIKE '%Усп%' OR prep_type LIKE '%усп%' THEN 0
                WHEN prep_type LIKE '%ЕГЭ%' AND subject LIKE '%Информ%' THEN 27
                WHEN prep_type LIKE '%ЕГЭ%' AND subject LIKE '%информ%' THEN 27
                WHEN prep_type LIKE '%ЕГЭ%' AND subject LIKE '%Матем%' THEN 19
                WHEN prep_type LIKE '%ЕГЭ%' AND subject LIKE '%матем%' THEN 19
                WHEN prep_type LIKE '%ОГЭ%' AND subject LIKE '%Информ%' THEN 16
                WHEN prep_type LIKE '%ОГЭ%' AND subject LIKE '%информ%' THEN 16
                WHEN prep_type LIKE '%ОГЭ%' AND subject LIKE '%Матем%' THEN 19
                WHEN prep_type LIKE '%ОГЭ%' AND subject LIKE '%матем%' THEN 19
                ELSE progress_goal
            END,
            progress_current = CASE
                WHEN prep_type LIKE '%Усп%' OR prep_type LIKE '%усп%' THEN 0
                ELSE progress_current
            END
            WHERE progress_goal IN (0, 15)
            """
        )
        self.conn.execute(
            """
            UPDATE students
            SET progress_current = progress_goal
            WHERE progress_goal > 0 AND progress_current > progress_goal
            """
        )
        self.conn.commit()

    def _ensure_tutor_profile(self) -> None:
        now = _dt(utc_now())
        self.conn.execute(
            """
            INSERT OR IGNORE INTO tutor_profile(
                id, full_name, experience, description, subjects_json, prep_types_json, working_days_json, created_at, updated_at
            )
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "",
                "",
                "",
                json.dumps(["Информатика", "Математика", "Русский язык"], ensure_ascii=False),
                json.dumps(["ЕГЭ", "ОГЭ", "Школьная программа", "Python", "Олимпиады"], ensure_ascii=False),
                json.dumps([1, 2, 3, 4, 5, 6, 7]),
                now,
                now,
            ),
        )
        self.conn.commit()

    def _migrate_payment_status_labels(self) -> None:
        self.conn.execute(
            "UPDATE lessons SET payment_status = ? WHERE payment_status = ?",
            ("оплачено", OLD_CONFIRMED_LESSON_PAYMENT_STATUS),
        )
        self.conn.commit()

    def upsert_user(self, user: UserAccount) -> UserAccount:
        created_at = user.created_at or utc_now()
        self.conn.execute(
            """
            INSERT INTO user_accounts(telegram_id, role, student_id, username, full_name, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(telegram_id) DO UPDATE SET
                role = excluded.role,
                student_id = excluded.student_id,
                username = excluded.username,
                full_name = excluded.full_name
            """,
            (
                user.telegram_id,
                user.role,
                user.student_id,
                user.username,
                user.full_name,
                _dt(created_at),
            ),
        )
        self.conn.commit()
        user.created_at = created_at
        return user

    def get_user(self, telegram_id: int) -> UserAccount | None:
        row = self.conn.execute(
            "SELECT * FROM user_accounts WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        return self._row_to_user(row) if row else None

    def add_browser_invite(
        self,
        token_hash: str,
        student_id: int,
        role: str,
        expires_at: datetime,
        session_days: int = 180,
        created_by: int | None = None,
    ) -> dict[str, Any]:
        now = utc_now()
        cursor = self.conn.execute(
            """
            INSERT INTO browser_invites(token_hash, student_id, role, session_days, created_by, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (token_hash, student_id, role, session_days, created_by, _dt(now), _dt(expires_at)),
        )
        self.conn.commit()
        invite = self.get_browser_invite(token_hash)
        if invite is None:
            raise RuntimeError("browser invite was not saved")
        invite["id"] = cursor.lastrowid
        return invite

    def get_browser_invite(self, token_hash: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT * FROM browser_invites WHERE token_hash = ?",
            (token_hash,),
        ).fetchone()
        return dict(row) if row else None

    def mark_browser_invite_used(self, invite_id: int, used_at: datetime | None = None) -> None:
        self.conn.execute(
            "UPDATE browser_invites SET used_at = ? WHERE id = ?",
            (_dt(used_at or utc_now()), invite_id),
        )
        self.conn.commit()

    def add_browser_session(
        self,
        token_hash: str,
        student_id: int,
        role: str,
        expires_at: datetime,
    ) -> dict[str, Any]:
        now = utc_now()
        cursor = self.conn.execute(
            """
            INSERT INTO browser_sessions(token_hash, student_id, role, created_at, expires_at, last_seen_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (token_hash, student_id, role, _dt(now), _dt(expires_at), _dt(now)),
        )
        self.conn.commit()
        session = self.get_browser_session(token_hash)
        if session is None:
            raise RuntimeError("browser session was not saved")
        session["id"] = cursor.lastrowid
        return session

    def get_browser_session(self, token_hash: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT * FROM browser_sessions WHERE token_hash = ?",
            (token_hash,),
        ).fetchone()
        return dict(row) if row else None

    def touch_browser_session(self, session_id: int) -> None:
        self.conn.execute(
            "UPDATE browser_sessions SET last_seen_at = ? WHERE id = ?",
            (_dt(utc_now()), session_id),
        )
        self.conn.commit()

    def add_tutor_browser_invite(
        self,
        token_hash: str,
        expires_at: datetime,
        session_days: int = 180,
        created_by: int | None = None,
    ) -> dict[str, Any]:
        now = utc_now()
        cursor = self.conn.execute(
            """
            INSERT INTO tutor_browser_invites(token_hash, session_days, created_by, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (token_hash, session_days, created_by, _dt(now), _dt(expires_at)),
        )
        self.conn.commit()
        invite = self.get_tutor_browser_invite(token_hash)
        if invite is None:
            raise RuntimeError("tutor browser invite was not saved")
        invite["id"] = cursor.lastrowid
        return invite

    def get_tutor_browser_invite(self, token_hash: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT * FROM tutor_browser_invites WHERE token_hash = ?",
            (token_hash,),
        ).fetchone()
        return dict(row) if row else None

    def mark_tutor_browser_invite_used(self, invite_id: int, used_at: datetime | None = None) -> None:
        self.conn.execute(
            "UPDATE tutor_browser_invites SET used_at = ? WHERE id = ?",
            (_dt(used_at or utc_now()), invite_id),
        )
        self.conn.commit()

    def add_tutor_browser_session(self, token_hash: str, expires_at: datetime) -> dict[str, Any]:
        now = utc_now()
        cursor = self.conn.execute(
            """
            INSERT INTO tutor_browser_sessions(token_hash, created_at, expires_at, last_seen_at)
            VALUES (?, ?, ?, ?)
            """,
            (token_hash, _dt(now), _dt(expires_at), _dt(now)),
        )
        self.conn.commit()
        session = self.get_tutor_browser_session(token_hash)
        if session is None:
            raise RuntimeError("tutor browser session was not saved")
        session["id"] = cursor.lastrowid
        return session

    def get_tutor_browser_session(self, token_hash: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT * FROM tutor_browser_sessions WHERE token_hash = ?",
            (token_hash,),
        ).fetchone()
        return dict(row) if row else None

    def touch_tutor_browser_session(self, session_id: int) -> None:
        self.conn.execute(
            "UPDATE tutor_browser_sessions SET last_seen_at = ? WHERE id = ?",
            (_dt(utc_now()), session_id),
        )
        self.conn.commit()

    def add_student(self, profile: StudentProfile) -> StudentProfile:
        existing = None
        for contact in (profile.student_telegram, profile.parent_telegram):
            existing = self.find_student_by_contact(contact)
            if existing is not None:
                break
        if existing is None:
            existing = self.find_student_by_identity(profile.full_name, profile.grade, profile.subject)
        if existing is not None:
            profile.id = existing.id
            profile.created_at = existing.created_at
            return existing

        created_at = profile.created_at or utc_now()
        cur = self.conn.execute(
            """
            INSERT INTO students(
                full_name, grade, prep_type, subject, goal, current_level,
                lesson_price, price_60, price_90, price_120,
                lesson_duration_minutes, lesson_format, board_url, meeting_url,
                student_telegram, parent_telegram, parent_name, parent_can_edit, payer, timezone, preferred_days_times,
                start_date, exam_date, comment, status, balance_mode, balance_lessons,
                balance_money, progress_current, progress_goal, mock_tasks_solved, mock_tasks_total,
                mock_score, mock_date, prep_plan_text, prep_plan_file_id,
                debt_reminder_sent_on, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                profile.full_name,
                profile.grade,
                profile.prep_type,
                profile.subject,
                profile.goal,
                profile.current_level,
                profile.lesson_price,
                profile.price_60,
                profile.price_90,
                profile.price_120,
                profile.lesson_duration_minutes,
                profile.lesson_format,
                profile.board_url,
                profile.meeting_url,
                profile.student_telegram,
                profile.parent_telegram,
                profile.parent_name,
                int(profile.parent_can_edit),
                profile.payer,
                profile.timezone,
                profile.preferred_days_times,
                _date(profile.start_date),
                _date(profile.exam_date),
                profile.comment,
                profile.status,
                profile.balance_mode,
                profile.balance_lessons,
                profile.balance_money,
                profile.progress_current,
                profile.progress_goal,
                profile.mock_tasks_solved,
                profile.mock_tasks_total,
                profile.mock_score,
                _date(profile.mock_date),
                profile.prep_plan_text,
                profile.prep_plan_file_id,
                _date(profile.debt_reminder_sent_on),
                _dt(created_at),
            ),
        )
        self.conn.commit()
        profile.id = int(cur.lastrowid)
        profile.created_at = created_at
        return profile

    def update_student(self, profile: StudentProfile) -> None:
        if profile.id is None:
            raise ValueError("student id is required")
        self.conn.execute(
            """
            UPDATE students SET
                full_name = ?, grade = ?, prep_type = ?, subject = ?, goal = ?,
                current_level = ?, lesson_price = ?, price_60 = ?, price_90 = ?, price_120 = ?,
                lesson_duration_minutes = ?,
                lesson_format = ?, board_url = ?, meeting_url = ?, student_telegram = ?,
                parent_telegram = ?, parent_name = ?, parent_can_edit = ?, payer = ?, timezone = ?, preferred_days_times = ?,
                start_date = ?, exam_date = ?, comment = ?, status = ?, balance_mode = ?,
                balance_lessons = ?, balance_money = ?, progress_current = ?, progress_goal = ?,
                mock_tasks_solved = ?, mock_tasks_total = ?, mock_score = ?, mock_date = ?,
                prep_plan_text = ?, prep_plan_file_id = ?, debt_reminder_sent_on = ?
            WHERE id = ?
            """,
            (
                profile.full_name,
                profile.grade,
                profile.prep_type,
                profile.subject,
                profile.goal,
                profile.current_level,
                profile.lesson_price,
                profile.price_60,
                profile.price_90,
                profile.price_120,
                profile.lesson_duration_minutes,
                profile.lesson_format,
                profile.board_url,
                profile.meeting_url,
                profile.student_telegram,
                profile.parent_telegram,
                profile.parent_name,
                int(profile.parent_can_edit),
                profile.payer,
                profile.timezone,
                profile.preferred_days_times,
                _date(profile.start_date),
                _date(profile.exam_date),
                profile.comment,
                profile.status,
                profile.balance_mode,
                profile.balance_lessons,
                profile.balance_money,
                profile.progress_current,
                profile.progress_goal,
                profile.mock_tasks_solved,
                profile.mock_tasks_total,
                profile.mock_score,
                _date(profile.mock_date),
                profile.prep_plan_text,
                profile.prep_plan_file_id,
                _date(profile.debt_reminder_sent_on),
                profile.id,
            ),
        )
        self.conn.commit()

    def get_student(self, student_id: int) -> StudentProfile | None:
        row = self.conn.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
        return self._row_to_student(row) if row else None

    def list_students(self, include_archived: bool = False) -> list[StudentProfile]:
        if include_archived:
            rows = self.conn.execute("SELECT * FROM students ORDER BY full_name").fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM students WHERE status != ? ORDER BY full_name",
                (StudentStatus.ARCHIVED.value,),
            ).fetchall()
        return [self._row_to_student(row) for row in rows]

    def archive_student(self, student_id: int) -> None:
        self.conn.execute(
            "UPDATE students SET status = ? WHERE id = ?",
            (StudentStatus.ARCHIVED.value, student_id),
        )
        self.conn.execute(
            """
            UPDATE lessons
            SET status = ?
            WHERE student_id = ? AND status = ?
            """,
            (
                LessonStatus.CANCELLED_BY_TEACHER.value,
                student_id,
                LessonStatus.PLANNED.value,
            ),
        )
        self.conn.commit()

    def delete_student(self, student_id: int) -> None:
        self.conn.execute("DELETE FROM user_accounts WHERE student_id = ?", (student_id,))
        self.conn.execute("DELETE FROM students WHERE id = ?", (student_id,))
        self.conn.commit()

    def delete_lesson(self, lesson_id: int) -> None:
        self.conn.execute("DELETE FROM lessons WHERE id = ?", (lesson_id,))
        self.conn.commit()

    def delete_homework(self, homework_id: int) -> None:
        self.conn.execute("UPDATE lessons SET homework_id = NULL WHERE homework_id = ?", (homework_id,))
        self.conn.execute("DELETE FROM homework_submissions WHERE homework_id = ?", (homework_id,))
        self.conn.execute("DELETE FROM homeworks WHERE id = ?", (homework_id,))
        self.conn.commit()

    def add_lesson(self, lesson: Lesson) -> Lesson:
        existing = self.find_duplicate_lesson(lesson)
        if existing is not None:
            lesson.id = existing.id
            lesson.created_at = existing.created_at
            return existing

        created_at = lesson.created_at or utc_now()
        cur = self.conn.execute(
            """
            INSERT INTO lessons(
                student_id, starts_at, duration_minutes, status, topic, homework_id, charged,
                cancellation_reason, cancelled_by, next_plan, stable_series_id, reminder_sent_at, post_lesson_reminder_sent_at,
                payment_status, payment_marked_by, payment_confirmed_at, payment_amount, notes,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                lesson.student_id,
                _dt(lesson.starts_at),
                lesson.duration_minutes,
                lesson.status,
                lesson.topic,
                lesson.homework_id,
                int(lesson.charged),
                lesson.cancellation_reason,
                lesson.cancelled_by,
                lesson.next_plan,
                lesson.stable_series_id,
                _dt(lesson.reminder_sent_at),
                _dt(lesson.post_lesson_reminder_sent_at),
                lesson.payment_status,
                lesson.payment_marked_by,
                _dt(lesson.payment_confirmed_at),
                lesson.payment_amount,
                lesson.notes,
                _dt(created_at),
            ),
        )
        self.conn.commit()
        lesson.id = int(cur.lastrowid)
        lesson.created_at = created_at
        return lesson

    def update_lesson(self, lesson: Lesson) -> None:
        if lesson.id is None:
            raise ValueError("lesson id is required")
        self.conn.execute(
            """
            UPDATE lessons SET
                student_id = ?, starts_at = ?, duration_minutes = ?, status = ?, topic = ?,
                homework_id = ?, charged = ?, cancellation_reason = ?, cancelled_by = ?,
                next_plan = ?, stable_series_id = ?, reminder_sent_at = ?, post_lesson_reminder_sent_at = ?,
                payment_status = ?, payment_marked_by = ?, payment_confirmed_at = ?,
                payment_amount = ?, notes = ?
            WHERE id = ?
            """,
            (
                lesson.student_id,
                _dt(lesson.starts_at),
                lesson.duration_minutes,
                lesson.status,
                lesson.topic,
                lesson.homework_id,
                int(lesson.charged),
                lesson.cancellation_reason,
                lesson.cancelled_by,
                lesson.next_plan,
                lesson.stable_series_id,
                _dt(lesson.reminder_sent_at),
                _dt(lesson.post_lesson_reminder_sent_at),
                lesson.payment_status,
                lesson.payment_marked_by,
                _dt(lesson.payment_confirmed_at),
                lesson.payment_amount,
                lesson.notes,
                lesson.id,
            ),
        )
        self.conn.commit()

    def get_lesson(self, lesson_id: int) -> Lesson | None:
        row = self.conn.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,)).fetchone()
        return self._row_to_lesson(row) if row else None

    def find_duplicate_lesson(self, lesson: Lesson) -> Lesson | None:
        row = self.conn.execute(
            """
            SELECT * FROM lessons
            WHERE student_id = ?
              AND starts_at = ?
              AND duration_minutes = ?
              AND status NOT IN (?, ?, ?)
            ORDER BY id
            LIMIT 1
            """,
            (
                lesson.student_id,
                _dt(lesson.starts_at),
                lesson.duration_minutes,
                LessonStatus.CANCELLED_BY_STUDENT.value,
                LessonStatus.CANCELLED_BY_TEACHER.value,
                LessonStatus.CANCELLED_BY_PARENT.value,
            ),
        ).fetchone()
        return self._row_to_lesson(row) if row else None

    def list_lessons_between(
        self,
        starts_at: datetime,
        ends_at: datetime,
        include_cancelled: bool = False,
    ) -> list[Lesson]:
        query = "SELECT * FROM lessons WHERE starts_at < ?"
        params: list[Any] = [_dt(ends_at)]
        if not include_cancelled:
            query += " AND status NOT IN (?, ?, ?)"
            params.extend(
                [
                    LessonStatus.CANCELLED_BY_STUDENT.value,
                    LessonStatus.CANCELLED_BY_TEACHER.value,
                    LessonStatus.CANCELLED_BY_PARENT.value,
                ]
            )
        query += " ORDER BY starts_at"
        rows = self.conn.execute(query, params).fetchall()
        lessons = [self._row_to_lesson(row) for row in rows]
        return [lesson for lesson in lessons if lesson.ends_at > starts_at]

    def last_reminder_sent_at(self) -> datetime | None:
        """Когда цикл напоминаний последний раз успешно доставил напоминание.

        Читается веб-процессом, а пишется процессом бота — это единственный
        внешний признак того, что фоновый цикл жив. Только чтение.
        """
        row = self.conn.execute(
            "SELECT MAX(reminder_sent_at) AS ts FROM lessons WHERE reminder_sent_at IS NOT NULL"
        ).fetchone()
        return _parse_dt(row["ts"]) if row and row["ts"] else None

    def list_cancelled_lessons_between(
        self,
        starts_at: datetime,
        ends_at: datetime,
    ) -> list[Lesson]:
        """Только отменённые занятия окна — для режима архива."""
        rows = self.conn.execute(
            "SELECT * FROM lessons WHERE starts_at < ? AND status IN (?, ?, ?) ORDER BY starts_at",
            (
                _dt(ends_at),
                LessonStatus.CANCELLED_BY_STUDENT.value,
                LessonStatus.CANCELLED_BY_TEACHER.value,
                LessonStatus.CANCELLED_BY_PARENT.value,
            ),
        ).fetchall()
        lessons = [self._row_to_lesson(row) for row in rows]
        return [lesson for lesson in lessons if lesson.ends_at > starts_at]

    def list_student_lessons(self, student_id: int, limit: int = 20) -> list[Lesson]:
        rows = self.conn.execute(
            "SELECT * FROM lessons WHERE student_id = ? ORDER BY starts_at DESC LIMIT ?",
            (student_id, limit),
        ).fetchall()
        return [self._row_to_lesson(row) for row in rows]

    def list_student_lessons_after(self, student_id: int, starts_at: datetime, limit: int = 100) -> list[Lesson]:
        rows = self.conn.execute(
            "SELECT * FROM lessons WHERE student_id = ? AND starts_at >= ? ORDER BY starts_at, id LIMIT ?",
            (student_id, _dt(starts_at), limit),
        ).fetchall()
        return [self._row_to_lesson(row) for row in rows]

    def list_conducted_lessons(self) -> list[Lesson]:
        rows = self.conn.execute(
            "SELECT * FROM lessons WHERE status = ? ORDER BY starts_at, id",
            (LessonStatus.CONDUCTED.value,),
        ).fetchall()
        return [self._row_to_lesson(row) for row in rows]

    def list_users_by_student(self, student_id: int) -> list[UserAccount]:
        rows = self.conn.execute(
            "SELECT * FROM user_accounts WHERE student_id = ? ORDER BY role", (student_id,)
        ).fetchall()
        return [self._row_to_user(row) for row in rows]

    def list_user_accounts(self) -> list[UserAccount]:
        rows = self.conn.execute(
            "SELECT * FROM user_accounts ORDER BY telegram_id"
        ).fetchall()
        return [self._row_to_user(row) for row in rows]

    def find_student_by_contact(self, contact: str) -> StudentProfile | None:
        normalized = contact.strip()
        if not normalized:
            return None
        variants = {normalized, normalized.lstrip("@"), f"@{normalized.lstrip('@')}"}
        placeholders = ",".join("?" for _ in variants)
        row = self.conn.execute(
            f"""
            SELECT * FROM students
            WHERE student_telegram IN ({placeholders})
               OR parent_telegram IN ({placeholders})
            LIMIT 1
            """,
            tuple(variants) + tuple(variants),
        ).fetchone()
        return self._row_to_student(row) if row else None

    def find_student_by_identity(
        self,
        full_name: str,
        grade: str = "",
        subject: str = "",
    ) -> StudentProfile | None:
        normalized_name = " ".join(full_name.split())
        if not normalized_name:
            return None
        row = self.conn.execute(
            """
            SELECT * FROM students
            WHERE status != ?
              AND lower(trim(full_name)) = lower(?)
              AND (? = '' OR lower(trim(grade)) = lower(?))
              AND (? = '' OR lower(trim(subject)) = lower(?))
            ORDER BY id
            LIMIT 1
            """,
            (
                StudentStatus.ARCHIVED.value,
                normalized_name,
                grade.strip(),
                grade.strip(),
                subject.strip(),
                subject.strip(),
            ),
        ).fetchone()
        return self._row_to_student(row) if row else None

    def add_closed_slot(self, slot: ClosedSlot) -> ClosedSlot:
        created_at = slot.created_at or utc_now()
        cur = self.conn.execute(
            """
            INSERT INTO closed_slots(starts_at, ends_at, reason, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (_dt(slot.starts_at), _dt(slot.ends_at), slot.reason, _dt(created_at)),
        )
        self.conn.commit()
        slot.id = int(cur.lastrowid)
        slot.created_at = created_at
        return slot

    def list_closed_slots_between(self, starts_at: datetime, ends_at: datetime) -> list[ClosedSlot]:
        rows = self.conn.execute(
            "SELECT * FROM closed_slots WHERE starts_at < ? AND ends_at > ? ORDER BY starts_at",
            (_dt(ends_at), _dt(starts_at)),
        ).fetchall()
        return [self._row_to_closed_slot(row) for row in rows]

    def get_closed_slot(self, slot_id: int) -> ClosedSlot | None:
        row = self.conn.execute("SELECT * FROM closed_slots WHERE id = ?", (slot_id,)).fetchone()
        return self._row_to_closed_slot(row) if row else None

    def delete_closed_slot(self, slot_id: int) -> None:
        self.conn.execute("DELETE FROM closed_slots WHERE id = ?", (slot_id,))
        self.conn.commit()

    def add_payment(self, payment: Payment) -> Payment:
        created_at = payment.created_at or utc_now()
        cur = self.conn.execute(
            """
            INSERT INTO payments(
                student_id, amount, lessons_count, sender_role, sender_telegram_id,
                lesson_id, receipt_file_id, status, comment, balance_after_lessons, balance_after_money,
                created_at, confirmed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payment.student_id,
                payment.amount,
                payment.lessons_count,
                payment.sender_role,
                payment.sender_telegram_id,
                payment.lesson_id,
                payment.receipt_file_id,
                payment.status,
                payment.comment,
                payment.balance_after_lessons,
                payment.balance_after_money,
                _dt(created_at),
                _dt(payment.confirmed_at),
            ),
        )
        self.conn.commit()
        payment.id = int(cur.lastrowid)
        payment.created_at = created_at
        return payment

    def update_payment(self, payment: Payment) -> None:
        if payment.id is None:
            raise ValueError("payment id is required")
        self.conn.execute(
            """
            UPDATE payments SET
                amount = ?, lessons_count = ?, sender_role = ?, sender_telegram_id = ?,
                lesson_id = ?, receipt_file_id = ?, status = ?, comment = ?, balance_after_lessons = ?,
                balance_after_money = ?, confirmed_at = ?
            WHERE id = ?
            """,
            (
                payment.amount,
                payment.lessons_count,
                payment.sender_role,
                payment.sender_telegram_id,
                payment.lesson_id,
                payment.receipt_file_id,
                payment.status,
                payment.comment,
                payment.balance_after_lessons,
                payment.balance_after_money,
                _dt(payment.confirmed_at),
                payment.id,
            ),
        )
        self.conn.commit()

    def get_payment(self, payment_id: int) -> Payment | None:
        row = self.conn.execute("SELECT * FROM payments WHERE id = ?", (payment_id,)).fetchone()
        return self._row_to_payment(row) if row else None

    def list_pending_payments(self) -> list[Payment]:
        rows = self.conn.execute(
            "SELECT * FROM payments WHERE status = ? ORDER BY created_at",
            (PaymentStatus.PENDING.value,),
        ).fetchall()
        return [self._row_to_payment(row) for row in rows]

    def list_student_payments(self, student_id: int) -> list[Payment]:
        rows = self.conn.execute(
            "SELECT * FROM payments WHERE student_id = ? ORDER BY created_at DESC",
            (student_id,),
        ).fetchall()
        return [self._row_to_payment(row) for row in rows]

    def list_all_payments(self) -> list[Payment]:
        rows = self.conn.execute("SELECT * FROM payments ORDER BY created_at DESC").fetchall()
        return [self._row_to_payment(row) for row in rows]

    def add_homework(self, homework: Homework) -> Homework:
        existing = self.find_recent_duplicate_homework(homework)
        if existing is not None:
            homework.id = existing.id
            homework.created_at = existing.created_at
            return existing

        created_at = homework.created_at or utc_now()
        cur = self.conn.execute(
            """
            INSERT INTO homeworks(
                student_id, title, text, estimated_minutes, deadline, status, materials_json, links_json, teacher_comment,
                created_at, updated_at, checked_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                homework.student_id,
                homework.title,
                homework.text,
                homework.estimated_minutes,
                _dt(homework.deadline),
                homework.status,
                json.dumps(homework.materials, ensure_ascii=False),
                json.dumps(homework.links, ensure_ascii=False),
                homework.teacher_comment,
                _dt(created_at),
                _dt(homework.updated_at or created_at),
                _dt(homework.checked_at),
            ),
        )
        self.conn.commit()
        homework.id = int(cur.lastrowid)
        homework.created_at = created_at
        return homework

    def update_homework(self, homework: Homework) -> None:
        if homework.id is None:
            raise ValueError("homework id is required")
        self.conn.execute(
            """
            UPDATE homeworks SET
                title = ?, text = ?, estimated_minutes = ?, deadline = ?, status = ?, materials_json = ?,
                links_json = ?, teacher_comment = ?, updated_at = ?, checked_at = ?
            WHERE id = ?
            """,
            (
                homework.title,
                homework.text,
                homework.estimated_minutes,
                _dt(homework.deadline),
                homework.status,
                json.dumps(homework.materials, ensure_ascii=False),
                json.dumps(homework.links, ensure_ascii=False),
                homework.teacher_comment,
                _dt(homework.updated_at or utc_now()),
                _dt(homework.checked_at),
                homework.id,
            ),
        )
        self.conn.commit()

    def get_homework(self, homework_id: int) -> Homework | None:
        row = self.conn.execute("SELECT * FROM homeworks WHERE id = ?", (homework_id,)).fetchone()
        return self._row_to_homework(row) if row else None

    def find_recent_duplicate_homework(self, homework: Homework) -> Homework | None:
        cutoff = utc_now().timestamp() - RECENT_DUPLICATE_SECONDS
        rows = self.conn.execute(
            """
            SELECT * FROM homeworks
            WHERE student_id = ?
              AND title = ?
              AND text = ?
              AND estimated_minutes = ?
              AND COALESCE(deadline, '') = COALESCE(?, '')
              AND status = ?
              AND materials_json = ?
              AND links_json = ?
              AND teacher_comment = ?
            ORDER BY id DESC
            LIMIT 20
            """,
            (
                homework.student_id,
                homework.title,
                homework.text,
                homework.estimated_minutes,
                _dt(homework.deadline),
                homework.status,
                json.dumps(homework.materials, ensure_ascii=False),
                json.dumps(homework.links, ensure_ascii=False),
                homework.teacher_comment,
            ),
        ).fetchall()
        for row in rows:
            existing = self._row_to_homework(row)
            if existing.created_at and existing.created_at.timestamp() >= cutoff:
                return existing
        return None

    def get_current_homework(self, student_id: int) -> Homework | None:
        rows = self.conn.execute(
            """
            SELECT * FROM homeworks
            WHERE student_id = ? AND status IN (?, ?, ?, ?)
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (
                student_id,
                HomeworkStatus.ASSIGNED.value,
                HomeworkStatus.WAITING.value,
                HomeworkStatus.SUBMITTED.value,
                HomeworkStatus.NEEDS_FIX.value,
            ),
        ).fetchall()
        return self._row_to_homework(rows[0]) if rows else None

    def list_homeworks(self, student_id: int | None = None, limit: int = 100) -> list[Homework]:
        if student_id is None:
            rows = self.conn.execute(
                "SELECT * FROM homeworks ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM homeworks WHERE student_id = ? ORDER BY created_at DESC LIMIT ?",
                (student_id, limit),
            ).fetchall()
        return [self._row_to_homework(row) for row in rows]

    def add_homework_submission(self, submission: HomeworkSubmission) -> HomeworkSubmission:
        created_at = submission.created_at or utc_now()
        cur = self.conn.execute(
            """
            INSERT INTO homework_submissions(homework_id, student_id, content, file_ids_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                submission.homework_id,
                submission.student_id,
                submission.content,
                json.dumps(submission.file_ids, ensure_ascii=False),
                _dt(created_at),
            ),
        )
        self.conn.commit()
        submission.id = int(cur.lastrowid)
        submission.created_at = created_at
        return submission

    def upsert_prep_topic(self, topic: PrepTopic) -> PrepTopic:
        if topic.id is None:
            cur = self.conn.execute(
                """
                INSERT INTO prep_topics(student_id, title, status, solved_count, knowledge_level, comment)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    topic.student_id,
                    topic.title,
                    topic.status,
                    topic.solved_count,
                    topic.knowledge_level,
                    topic.comment,
                ),
            )
            topic.id = int(cur.lastrowid)
        else:
            self.conn.execute(
                """
                UPDATE prep_topics SET title = ?, status = ?, solved_count = ?, knowledge_level = ?, comment = ?
                WHERE id = ?
                """,
                (
                    topic.title,
                    topic.status,
                    topic.solved_count,
                    topic.knowledge_level,
                    topic.comment,
                    topic.id,
                ),
            )
        self.conn.commit()
        return topic

    def get_prep_topic(self, topic_id: int) -> PrepTopic | None:
        row = self.conn.execute("SELECT * FROM prep_topics WHERE id = ?", (topic_id,)).fetchone()
        return self._row_to_prep_topic(row) if row else None

    def delete_prep_topic_note(self, topic_id: int) -> None:
        self.conn.execute("UPDATE prep_topics SET comment = '' WHERE id = ?", (topic_id,))
        self.conn.commit()

    def delete_prep_topic(self, topic_id: int) -> None:
        self.conn.execute("DELETE FROM prep_topics WHERE id = ?", (topic_id,))
        self.conn.commit()

    def find_prep_topic_by_title(self, student_id: int, title: str) -> PrepTopic | None:
        row = self.conn.execute(
            "SELECT * FROM prep_topics WHERE student_id = ? AND title = ? ORDER BY id LIMIT 1",
            (student_id, title),
        ).fetchone()
        return self._row_to_prep_topic(row) if row else None

    def list_prep_topics(self, student_id: int) -> list[PrepTopic]:
        rows = self.conn.execute(
            "SELECT * FROM prep_topics WHERE student_id = ? ORDER BY id", (student_id,)
        ).fetchall()
        return [self._row_to_prep_topic(row) for row in rows]

    def upsert_plan_item(self, item: PlanItem) -> PlanItem:
        if item.id is None:
            cur = self.conn.execute(
                """
                INSERT INTO plan_items(student_id, title, position, status, comment, deadline)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    item.student_id,
                    item.title,
                    item.position,
                    item.status,
                    item.comment,
                    _date(item.deadline),
                ),
            )
            item.id = int(cur.lastrowid)
        else:
            self.conn.execute(
                """
                UPDATE plan_items SET title = ?, position = ?, status = ?, comment = ?, deadline = ?
                WHERE id = ?
                """,
                (item.title, item.position, item.status, item.comment, _date(item.deadline), item.id),
            )
        self.conn.commit()
        return item

    def get_plan_item(self, item_id: int) -> PlanItem | None:
        row = self.conn.execute("SELECT * FROM plan_items WHERE id = ?", (item_id,)).fetchone()
        return self._row_to_plan_item(row) if row else None

    def delete_plan_item(self, item_id: int) -> None:
        self.conn.execute("DELETE FROM plan_items WHERE id = ?", (item_id,))
        self.conn.commit()

    def list_plan_items(self, student_id: int) -> list[PlanItem]:
        rows = self.conn.execute(
            "SELECT * FROM plan_items WHERE student_id = ? ORDER BY position, id", (student_id,)
        ).fetchall()
        return [self._row_to_plan_item(row) for row in rows]

    def _json_list(self, raw: str | None) -> list[str]:
        try:
            values = json.loads(raw or "[]")
        except json.JSONDecodeError:
            return []
        return [str(item).strip() for item in values if str(item).strip()]

    def _json_int_list(self, raw: str | None) -> list[int]:
        try:
            values = json.loads(raw or "[]")
        except json.JSONDecodeError:
            return []
        cleaned: list[int] = []
        for item in values:
            try:
                value = int(item)
            except (TypeError, ValueError):
                continue
            cleaned.append(value)
        return cleaned

    def get_tutor_profile(self) -> dict[str, Any]:
        row = self.conn.execute("SELECT * FROM tutor_profile WHERE id = 1").fetchone()
        if row is None:
            return {
                "full_name": "",
                "experience": "",
                "description": "",
                "subjects": [],
                "prep_types": [],
                "working_days": [1, 2, 3, 4, 5, 6, 7],
            }
        return {
            "full_name": row["full_name"],
            "experience": row["experience"],
            "description": row["description"],
            "subjects": self._json_list(row["subjects_json"]),
            "prep_types": self._json_list(row["prep_types_json"]),
            "working_days": [day for day in self._json_int_list(row["working_days_json"]) if 1 <= day <= 7],
        }

    def _clean_unique(self, values: list[str]) -> list[str]:
        cleaned = []
        for item in values:
            value = " ".join(str(item).split())
            if value and value not in cleaned:
                cleaned.append(value)
        return cleaned

    def update_tutor_profile(
        self,
        *,
        full_name: str = "",
        experience: str = "",
        description: str = "",
        subjects: list[str] | None = None,
        prep_types: list[str] | None = None,
        working_days: list[int] | None = None,
    ) -> dict[str, Any]:
        subjects_cleaned = self._clean_unique(subjects or [])
        prep_types_cleaned = self._clean_unique(prep_types or [])
        days_cleaned = sorted({int(day) for day in (working_days or [1, 2, 3, 4, 5, 6, 7]) if 1 <= int(day) <= 7})
        now = _dt(utc_now())
        self.conn.execute(
            """
            INSERT INTO tutor_profile(
                id, full_name, experience, description, subjects_json, prep_types_json, working_days_json, created_at, updated_at
            )
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                full_name = excluded.full_name,
                experience = excluded.experience,
                description = excluded.description,
                subjects_json = excluded.subjects_json,
                prep_types_json = excluded.prep_types_json,
                working_days_json = excluded.working_days_json,
                updated_at = excluded.updated_at
            """,
            (
                " ".join(str(full_name).split()),
                str(experience).strip(),
                str(description).strip(),
                json.dumps(subjects_cleaned, ensure_ascii=False),
                json.dumps(prep_types_cleaned, ensure_ascii=False),
                json.dumps(days_cleaned, ensure_ascii=False),
                now,
                now,
            ),
        )
        self.conn.commit()
        return self.get_tutor_profile()

    def add_schedule_rule(self, rule: ScheduleRule) -> ScheduleRule:
        created_at = rule.created_at or utc_now()
        cur = self.conn.execute(
            """
            INSERT INTO schedule_rules(
                student_id, weekdays_json, lesson_time, duration_minutes,
                starts_at, ends_at, is_active, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rule.student_id,
                json.dumps(rule.weekdays),
                rule.lesson_time,
                rule.duration_minutes,
                _date(rule.starts_at),
                _date(rule.ends_at),
                int(rule.is_active),
                _dt(created_at),
            ),
        )
        self.conn.commit()
        rule.id = int(cur.lastrowid)
        rule.created_at = created_at
        return rule

    def update_schedule_rule(self, rule: ScheduleRule) -> None:
        if rule.id is None:
            raise ValueError("schedule rule id is required")
        self.conn.execute(
            """
            UPDATE schedule_rules SET
                student_id = ?, weekdays_json = ?, lesson_time = ?, duration_minutes = ?,
                starts_at = ?, ends_at = ?, is_active = ?
            WHERE id = ?
            """,
            (
                rule.student_id,
                json.dumps(rule.weekdays),
                rule.lesson_time,
                rule.duration_minutes,
                _date(rule.starts_at),
                _date(rule.ends_at),
                int(rule.is_active),
                rule.id,
            ),
        )
        self.conn.commit()

    def list_schedule_rules(self, student_id: int | None = None) -> list[ScheduleRule]:
        if student_id is None:
            rows = self.conn.execute(
                "SELECT * FROM schedule_rules ORDER BY student_id, id"
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT * FROM schedule_rules WHERE student_id = ? ORDER BY id",
                (student_id,),
            ).fetchall()
        return [self._row_to_schedule_rule(row) for row in rows]

    def delete_schedule_rules_for_student(self, student_id: int) -> int:
        cursor = self.conn.execute("DELETE FROM schedule_rules WHERE student_id = ?", (student_id,))
        self.conn.commit()
        return cursor.rowcount

    def list_lesson_ids_with_payments(self, student_id: int) -> set[int]:
        rows = self.conn.execute(
            "SELECT DISTINCT lesson_id FROM payments WHERE student_id = ? AND lesson_id IS NOT NULL",
            (student_id,),
        ).fetchall()
        return {int(row["lesson_id"]) for row in rows}

    def list_debtors(self) -> list[StudentProfile]:
        rows = self.conn.execute(
            """
            SELECT * FROM students
            WHERE status != ?
              AND (
                (balance_mode = 'lessons' AND balance_lessons < 0)
                OR (balance_mode = 'money' AND balance_money < 0)
              )
            ORDER BY full_name
            """,
            (StudentStatus.ARCHIVED.value,),
        ).fetchall()
        return [self._row_to_student(row) for row in rows]

    def list_students_for_debt_reminder(self, today: date) -> list[StudentProfile]:
        rows = self.conn.execute(
            """
            SELECT * FROM students
            WHERE status != ?
              AND (
                (balance_mode = 'lessons' AND balance_lessons < 0)
                OR (balance_mode = 'money' AND balance_money < 0)
              )
              AND (debt_reminder_sent_on IS NULL OR debt_reminder_sent_on != ?)
            ORDER BY full_name
            """,
            (StudentStatus.ARCHIVED.value, _date(today)),
        ).fetchall()
        return [self._row_to_student(row) for row in rows]

    def mark_debt_reminder_sent(self, student_id: int, today: date) -> None:
        self.conn.execute(
            "UPDATE students SET debt_reminder_sent_on = ? WHERE id = ?",
            (_date(today), student_id),
        )
        self.conn.commit()

    def _row_to_user(self, row: sqlite3.Row) -> UserAccount:
        return UserAccount(
            telegram_id=row["telegram_id"],
            role=row["role"],
            student_id=row["student_id"],
            username=row["username"],
            full_name=row["full_name"],
            created_at=_parse_dt(row["created_at"]),
        )

    def _row_to_student(self, row: sqlite3.Row) -> StudentProfile:
        return StudentProfile(
            id=row["id"],
            full_name=row["full_name"],
            grade=row["grade"],
            prep_type=row["prep_type"],
            subject=row["subject"],
            goal=row["goal"],
            current_level=row["current_level"],
            lesson_price=row["lesson_price"],
            price_60=row["price_60"],
            price_90=row["price_90"],
            price_120=row["price_120"],
            lesson_duration_minutes=row["lesson_duration_minutes"],
            lesson_format=row["lesson_format"],
            board_url=row["board_url"],
            meeting_url=row["meeting_url"],
            student_telegram=row["student_telegram"],
            parent_telegram=row["parent_telegram"],
            parent_name=row["parent_name"],
            parent_can_edit=bool(row["parent_can_edit"]),
            payer=row["payer"],
            timezone=row["timezone"],
            preferred_days_times=row["preferred_days_times"],
            start_date=_parse_date(row["start_date"]),
            exam_date=_parse_date(row["exam_date"]),
            comment=row["comment"],
            status=row["status"],
            balance_mode=row["balance_mode"],
            balance_lessons=row["balance_lessons"],
            balance_money=row["balance_money"],
            progress_current=row["progress_current"],
            progress_goal=row["progress_goal"],
            mock_tasks_solved=row["mock_tasks_solved"],
            mock_tasks_total=row["mock_tasks_total"],
            mock_score=row["mock_score"],
            mock_date=_parse_date(row["mock_date"]),
            prep_plan_text=row["prep_plan_text"],
            prep_plan_file_id=row["prep_plan_file_id"],
            debt_reminder_sent_on=_parse_date(row["debt_reminder_sent_on"]),
            created_at=_parse_dt(row["created_at"]),
        )

    def _row_to_lesson(self, row: sqlite3.Row) -> Lesson:
        return Lesson(
            id=row["id"],
            student_id=row["student_id"],
            starts_at=_parse_dt(row["starts_at"]),
            duration_minutes=row["duration_minutes"],
            status=row["status"],
            topic=row["topic"],
            homework_id=row["homework_id"],
            charged=bool(row["charged"]),
            cancellation_reason=row["cancellation_reason"],
            cancelled_by=row["cancelled_by"],
            next_plan=row["next_plan"],
            stable_series_id=row["stable_series_id"],
            reminder_sent_at=_parse_dt(row["reminder_sent_at"]),
            post_lesson_reminder_sent_at=_parse_dt(row["post_lesson_reminder_sent_at"]),
            payment_status=row["payment_status"],
            payment_marked_by=row["payment_marked_by"],
            payment_confirmed_at=_parse_dt(row["payment_confirmed_at"]),
            payment_amount=row["payment_amount"],
            notes=row["notes"],
            created_at=_parse_dt(row["created_at"]),
        )

    def _row_to_closed_slot(self, row: sqlite3.Row) -> ClosedSlot:
        return ClosedSlot(
            id=row["id"],
            starts_at=_parse_dt(row["starts_at"]),
            ends_at=_parse_dt(row["ends_at"]),
            reason=row["reason"],
            created_at=_parse_dt(row["created_at"]),
        )

    def _row_to_payment(self, row: sqlite3.Row) -> Payment:
        return Payment(
            id=row["id"],
            student_id=row["student_id"],
            amount=row["amount"],
            lessons_count=row["lessons_count"],
            sender_role=row["sender_role"],
            lesson_id=row["lesson_id"],
            sender_telegram_id=row["sender_telegram_id"],
            receipt_file_id=row["receipt_file_id"],
            status=row["status"],
            comment=row["comment"],
            balance_after_lessons=row["balance_after_lessons"],
            balance_after_money=row["balance_after_money"],
            created_at=_parse_dt(row["created_at"]),
            confirmed_at=_parse_dt(row["confirmed_at"]),
        )

    def _row_to_homework(self, row: sqlite3.Row) -> Homework:
        return Homework(
            id=row["id"],
            student_id=row["student_id"],
            title=row["title"],
            text=row["text"],
            estimated_minutes=row["estimated_minutes"],
            deadline=_parse_dt(row["deadline"]),
            status=row["status"],
            materials=json.loads(row["materials_json"] or "[]"),
            links=json.loads(row["links_json"] or "[]"),
            teacher_comment=row["teacher_comment"],
            created_at=_parse_dt(row["created_at"]),
            updated_at=_parse_dt(row["updated_at"]),
            checked_at=_parse_dt(row["checked_at"]),
        )

    def _row_to_prep_topic(self, row: sqlite3.Row) -> PrepTopic:
        return PrepTopic(
            id=row["id"],
            student_id=row["student_id"],
            title=row["title"],
            status=row["status"],
            solved_count=row["solved_count"],
            knowledge_level=row["knowledge_level"],
            comment=row["comment"],
        )

    def _row_to_plan_item(self, row: sqlite3.Row) -> PlanItem:
        return PlanItem(
            id=row["id"],
            student_id=row["student_id"],
            title=row["title"],
            position=row["position"],
            status=row["status"],
            comment=row["comment"],
            deadline=_parse_date(row["deadline"]),
        )

    def _row_to_schedule_rule(self, row: sqlite3.Row) -> ScheduleRule:
        return ScheduleRule(
            id=row["id"],
            student_id=row["student_id"],
            weekdays=json.loads(row["weekdays_json"] or "[]"),
            lesson_time=row["lesson_time"],
            duration_minutes=row["duration_minutes"],
            starts_at=_parse_date(row["starts_at"]),
            ends_at=_parse_date(row["ends_at"]),
            is_active=bool(row["is_active"]),
            created_at=_parse_dt(row["created_at"]),
        )


def add_many_prep_topics(storage: SQLiteStorage, student_id: int, titles: Iterable[str]) -> None:
    for title in titles:
        storage.upsert_prep_topic(PrepTopic(student_id=student_id, title=title))
