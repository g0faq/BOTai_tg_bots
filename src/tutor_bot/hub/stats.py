from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any

CONDUCTED = "проведено"
CONFIRMED_PAYMENTS = {"оплачено", "подтверждено репетитором"}
UNPAID_PAYMENTS = {"не отмечено", "не оплачено"}
OPEN_HOMEWORKS = {"выдано", "ожидает выполнения", "в работе", "нужна доработка"}


@dataclass(slots=True)
class StatsResult:
    available: bool
    data: dict[str, Any]
    error: str = ""


def _range(today: date, days: int = 1) -> tuple[str, str]:
    start = datetime.combine(today, time.min)
    end = start + timedelta(days=days)
    return start.isoformat(), end.isoformat()


def collect_crm_stats(database_path: str, today: date | None = None) -> StatsResult:
    path = Path(database_path)
    if not database_path or not path.exists():
        return StatsResult(False, {}, "CRM database is not configured")
    today = today or datetime.now().date()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    ranges = {
        "today": _range(today),
        "week": _range(week_start, 7),
        "month": (datetime.combine(month_start, time.min).isoformat(), datetime.combine(next_month, time.min).isoformat()),
    }
    try:
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        students_count = conn.execute("SELECT COUNT(*) AS value FROM students").fetchone()["value"]
        lessons_today = _count_lessons(conn, *ranges["today"])
        lessons_week = _count_lessons(conn, *ranges["week"])
        income_today = _income(conn, *ranges["today"])
        income_week = _income(conn, *ranges["week"])
        income_month = _income(conn, *ranges["month"])
        expected_payments = _expected_payments(conn)
        homework_count = conn.execute(
            f"SELECT COUNT(*) AS value FROM homeworks WHERE status IN ({','.join('?' for _ in OPEN_HOMEWORKS)})",
            tuple(OPEN_HOMEWORKS),
        ).fetchone()["value"]
        last_activity = _last_activity(conn)
        conn.close()
        return StatsResult(
            True,
            {
                "students_count": int(students_count or 0),
                "lessons_today": int(lessons_today or 0),
                "lessons_week": int(lessons_week or 0),
                "income_today": int(income_today or 0),
                "income_week": int(income_week or 0),
                "income_month": int(income_month or 0),
                "expected_payments": int(expected_payments or 0),
                "debts_amount": int(expected_payments or 0),
                "homework_count": int(homework_count or 0),
                "last_activity_at": last_activity,
            },
        )
    except sqlite3.Error as exc:
        return StatsResult(False, {}, str(exc))


def _count_lessons(conn: sqlite3.Connection, start: str, end: str) -> int:
    return int(
        conn.execute(
            """
            SELECT COUNT(*) AS value
            FROM lessons
            WHERE starts_at >= ? AND starts_at < ? AND status != 'отменено'
            """,
            (start, end),
        ).fetchone()["value"]
        or 0
    )


def _income(conn: sqlite3.Connection, start: str, end: str) -> int:
    lesson_income = conn.execute(
        f"""
        SELECT COALESCE(SUM(payment_amount), 0) AS value
        FROM lessons
        WHERE status = ?
          AND payment_status IN ({','.join('?' for _ in CONFIRMED_PAYMENTS)})
          AND COALESCE(payment_confirmed_at, starts_at) >= ?
          AND COALESCE(payment_confirmed_at, starts_at) < ?
        """,
        (CONDUCTED, *CONFIRMED_PAYMENTS, start, end),
    ).fetchone()["value"]
    advance_income = conn.execute(
        """
        SELECT COALESCE(SUM(amount), 0) AS value
        FROM payments
        WHERE status = 'подтверждено'
          AND confirmed_at IS NOT NULL
          AND confirmed_at >= ?
          AND confirmed_at < ?
        """,
        (start, end),
    ).fetchone()["value"]
    return int(lesson_income or 0) + int(advance_income or 0)


def _expected_payments(conn: sqlite3.Connection) -> int:
    return int(
        conn.execute(
            f"""
            SELECT COALESCE(SUM(payment_amount), 0) AS value
            FROM lessons
            WHERE status = ?
              AND payment_status IN ({','.join('?' for _ in UNPAID_PAYMENTS)})
            """,
            (CONDUCTED, *UNPAID_PAYMENTS),
        ).fetchone()["value"]
        or 0
    )


def _last_activity(conn: sqlite3.Connection) -> str | None:
    values: list[str] = []
    for query in (
        "SELECT MAX(created_at) AS value FROM lessons",
        "SELECT MAX(created_at) AS value FROM payments",
        "SELECT MAX(updated_at) AS value FROM homeworks",
    ):
        row = conn.execute(query).fetchone()
        if row and row["value"]:
            values.append(str(row["value"]))
    return max(values) if values else None
