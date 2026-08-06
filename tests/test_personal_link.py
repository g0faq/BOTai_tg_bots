from __future__ import annotations

from datetime import UTC, datetime, time
from pathlib import Path

from tutor_bot.config import Settings
from tutor_bot.domain.enums import Role, StudentStatus
from tutor_bot.domain.models import StudentProfile
from tutor_bot.services.personal_link import (
    PERMANENT_DAYS,
    ensure_personal_invite,
    hash_browser_token,
    personal_link_url,
    personal_token,
)
from tutor_bot.storage.sqlite import SQLiteStorage

NOW = datetime(2026, 8, 7, 12, 0)


def make_settings(tmp_path: Path, token: str = "111:secret") -> Settings:
    return Settings(
        bot_token=token,
        admin_telegram_ids=[900],
        teacher_chat_url="",
        database_path=str(tmp_path / "b.sqlite3"),
        timezone="Europe/Moscow",
        default_lesson_price=1500,
        default_lesson_duration_minutes=60,
        default_payment_package_size=4,
        low_balance_threshold=1,
        reminder_minutes_before_lesson=5,
        working_days=[1, 2, 3, 4, 5, 6, 7],
        working_start=time(7, 0),
        working_end=time(23, 0),
        slot_step_minutes=30,
        webapp_url="https://botai-g0faq.amvera.io/",
    )


def make_db(settings: Settings) -> SQLiteStorage:
    db = SQLiteStorage(settings.database_path)
    db.add_student(StudentProfile(full_name="Аня", lesson_price=1500, status=StudentStatus.ACTIVE.value))
    return db


def test_link_is_stable_between_calls(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    db = make_db(settings)
    first = ensure_personal_invite(db, settings, Role.STUDENT.value, 1, NOW)
    second = ensure_personal_invite(db, settings, Role.STUDENT.value, 1, NOW)
    rows = db.conn.execute("SELECT COUNT(*) AS n FROM browser_invites").fetchone()["n"]
    db.close()

    assert first == second, "ссылка должна быть одна и та же при каждом нажатии"
    assert rows == 1, "повторный вызов не должен плодить приглашения"


def test_student_and_parent_get_different_links(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    db = make_db(settings)
    student = ensure_personal_invite(db, settings, Role.STUDENT.value, 1, NOW)
    parent = ensure_personal_invite(db, settings, Role.PARENT.value, 1, NOW)
    db.close()

    assert student != parent


def test_links_differ_between_students(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    assert personal_token(settings, Role.STUDENT.value, 1) != personal_token(settings, Role.STUDENT.value, 2)


def test_token_depends_on_bot_secret(tmp_path: Path) -> None:
    """Без токена бота ссылку не подобрать: это HMAC, а не номер по порядку."""
    a = make_settings(tmp_path, token="111:secret")
    b = make_settings(tmp_path, token="111:other")
    assert personal_token(a, Role.STUDENT.value, 1) != personal_token(b, Role.STUDENT.value, 1)


def test_invite_row_matches_the_token_hash(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    db = make_db(settings)
    token = ensure_personal_invite(db, settings, Role.STUDENT.value, 1, NOW)
    invite = db.get_browser_invite(hash_browser_token(token))
    db.close()

    assert invite is not None
    assert invite["role"] == Role.STUDENT.value
    assert int(invite["student_id"]) == 1


def test_link_is_long_lived(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    db = make_db(settings)
    token = ensure_personal_invite(db, settings, Role.STUDENT.value, 1, NOW)
    invite = db.get_browser_invite(hash_browser_token(token))
    db.close()

    expires = datetime.fromisoformat(invite["expires_at"])
    assert expires.tzinfo is not None, "срок должен храниться со смещением"
    assert (expires - NOW.replace(tzinfo=UTC)).days >= PERMANENT_DAYS - 1


def test_url_points_to_the_root_login_route(tmp_path: Path) -> None:
    """Роут входа живёт в корне, даже когда мини-апп открывается из /v2/."""
    settings = make_settings(tmp_path)
    url = personal_link_url(settings, "TOKEN")
    assert url == "https://botai-g0faq.amvera.io/login/TOKEN"
