from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

from tutor_bot.domain.enums import HomeworkStatus
from tutor_bot.domain.models import Homework, HomeworkSubmission, StudentProfile
from tutor_bot.services.homework_lifecycle import (
    ARCHIVE_AFTER_DAYS,
    PURGE_AFTER_DAYS,
    is_archived,
    is_expired,
    purge_expired,
    split_homeworks,
    submitted_at,
)
from tutor_bot.storage.sqlite import SQLiteStorage

NOW = datetime(2026, 8, 20, 12, 0)


def make_db(tmp_path: Path) -> SQLiteStorage:
    db = SQLiteStorage(str(tmp_path / "hw.sqlite3"))
    db.add_student(StudentProfile(full_name="Аня", lesson_price=1500))
    return db


def add(db: SQLiteStorage, *, title: str, status: str, submitted: datetime | None = None) -> Homework:
    homework = db.add_homework(
        Homework(student_id=1, text="задача", title=title, status=status, deadline=NOW - timedelta(days=30))
    )
    if submitted is not None:
        db.add_homework_submission(
            HomeworkSubmission(homework_id=int(homework.id), student_id=1, content="решение", created_at=submitted)
        )
    return homework


# --------------------------------------------------------------------------- #
# Архив: на следующий день после сдачи
# --------------------------------------------------------------------------- #


def test_submitted_today_stays_in_the_working_list(tmp_path: Path) -> None:
    db = make_db(tmp_path)
    hw = add(db, title="Сдана сегодня", status=HomeworkStatus.SUBMITTED.value, submitted=NOW - timedelta(hours=3))
    subs = db.homework_submission_dates()
    db.close()

    assert is_archived(hw, subs, NOW) is False, "в день сдачи домашка должна оставаться в работе"


def test_submitted_yesterday_goes_to_archive(tmp_path: Path) -> None:
    db = make_db(tmp_path)
    hw = add(db, title="Сдана вчера", status=HomeworkStatus.SUBMITTED.value, submitted=NOW - timedelta(days=1))
    subs = db.homework_submission_dates()
    db.close()

    assert is_archived(hw, subs, NOW) is True


def test_archive_counts_calendar_days_not_hours(tmp_path: Path) -> None:
    """Сдано вчера в 23:50, сейчас 12:00 — прошло 12 часов, но день другой."""
    db = make_db(tmp_path)
    hw = add(
        db,
        title="Поздняя сдача",
        status=HomeworkStatus.SUBMITTED.value,
        submitted=NOW.replace(hour=23, minute=50) - timedelta(days=1),
    )
    subs = db.homework_submission_dates()
    db.close()

    assert is_archived(hw, subs, NOW) is True


def test_unsubmitted_never_archives(tmp_path: Path) -> None:
    db = make_db(tmp_path)
    hw = add(db, title="Не сдана", status=HomeworkStatus.WAITING.value)
    subs = db.homework_submission_dates()
    db.close()

    assert submitted_at(hw, subs) is None
    assert is_archived(hw, subs, NOW) is False
    assert is_expired(hw, subs, NOW) is False


def test_manual_done_without_submission_uses_update_time(tmp_path: Path) -> None:
    """Преподаватель отметил выполнение вручную — сдачи в базе нет."""
    db = make_db(tmp_path)
    hw = add(db, title="Отмечена вручную", status=HomeworkStatus.DONE.value)
    hw.updated_at = NOW - timedelta(days=3)
    subs = db.homework_submission_dates()
    db.close()

    assert is_archived(hw, subs, NOW) is True


def test_split_separates_working_list_from_archive(tmp_path: Path) -> None:
    db = make_db(tmp_path)
    fresh = add(db, title="Сегодня", status=HomeworkStatus.SUBMITTED.value, submitted=NOW - timedelta(hours=1))
    old = add(db, title="Вчера", status=HomeworkStatus.SUBMITTED.value, submitted=NOW - timedelta(days=2))
    open_one = add(db, title="В работе", status=HomeworkStatus.WAITING.value)
    subs = db.homework_submission_dates()
    result = split_homeworks(db.list_homeworks(limit=100), subs, NOW)
    db.close()

    assert {h.id for h in result.current} == {fresh.id, open_one.id}
    assert {h.id for h in result.archived} == {old.id}


# --------------------------------------------------------------------------- #
# Удаление: через 10 дней после сдачи
# --------------------------------------------------------------------------- #


def test_purge_removes_only_homeworks_older_than_ten_days(tmp_path: Path) -> None:
    db = make_db(tmp_path)
    old = add(db, title="11 дней", status=HomeworkStatus.DONE.value, submitted=NOW - timedelta(days=11))
    edge = add(db, title="9 дней", status=HomeworkStatus.DONE.value, submitted=NOW - timedelta(days=9))
    open_one = add(db, title="Не сдана год назад", status=HomeworkStatus.WAITING.value)

    removed = purge_expired(db, NOW)
    left = {h.id for h in db.list_homeworks(limit=100)}
    db.close()

    assert removed == [int(old.id)]
    assert left == {edge.id, open_one.id}, "несданное и свежее удалять нельзя"


def test_purge_boundary_is_exactly_ten_days(tmp_path: Path) -> None:
    db = make_db(tmp_path)
    add(db, title="Ровно 10 дней", status=HomeworkStatus.DONE.value, submitted=NOW - timedelta(days=PURGE_AFTER_DAYS))
    removed = purge_expired(db, NOW)
    db.close()

    assert len(removed) == 1


def test_purge_deletes_submissions_too(tmp_path: Path) -> None:
    db = make_db(tmp_path)
    old = add(db, title="Старая", status=HomeworkStatus.DONE.value, submitted=NOW - timedelta(days=15))
    purge_expired(db, NOW)
    left = db.conn.execute(
        "SELECT COUNT(*) AS n FROM homework_submissions WHERE homework_id = ?", (int(old.id),)
    ).fetchone()["n"]
    db.close()

    assert left == 0, "сдачи должны удаляться вместе с домашкой"


def test_purge_is_idempotent(tmp_path: Path) -> None:
    db = make_db(tmp_path)
    add(db, title="Старая", status=HomeworkStatus.DONE.value, submitted=NOW - timedelta(days=20))
    first = purge_expired(db, NOW)
    second = purge_expired(db, NOW)
    db.close()

    assert len(first) == 1
    assert second == []


def test_constants_match_the_agreed_rules() -> None:
    assert ARCHIVE_AFTER_DAYS == 1
    assert PURGE_AFTER_DAYS == 10
