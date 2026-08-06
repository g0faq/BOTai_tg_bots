from __future__ import annotations

import hashlib
import hmac
import json
from datetime import date, datetime, time, timedelta
from pathlib import Path
from urllib.parse import urlencode

from fastapi.testclient import TestClient

from tutor_bot.config import Settings
from tutor_bot.domain.enums import (
    LessonPaymentStatus,
    LessonStatus,
    PaymentStatus,
    Role,
    StudentStatus,
)
from tutor_bot.domain.models import Lesson, Payment, ScheduleRule, StudentProfile, UserAccount
from tutor_bot.services.schedule_cleanup import apply_cleanup, plan_cleanup
from tutor_bot.storage.sqlite import SQLiteStorage
from tutor_bot.webapp import create_app

ADMIN_ID = 900
STUDENT_TG_ID = 101


def make_settings(tmp_path: Path) -> Settings:
    return Settings(
        bot_token="123456:test-token",
        admin_telegram_ids=[ADMIN_ID],
        teacher_chat_url="",
        database_path=str(tmp_path / "bot.sqlite3"),
        timezone="Europe/Moscow",
        default_lesson_price=2000,
        default_lesson_duration_minutes=60,
        default_payment_package_size=4,
        low_balance_threshold=1,
        reminder_minutes_before_lesson=5,
        working_days=[1, 2, 3, 4, 5, 6, 7],
        working_start=time(7, 0),
        working_end=time(23, 0),
        slot_step_minutes=30,
        webapp_url="http://127.0.0.1:8000",
    )


def signed_init_data(bot_token: str, user_id: int) -> str:
    values = {
        "auth_date": "1780000000",
        "query_id": "AAEAAAE",
        "user": json.dumps({"id": user_id, "first_name": "Test"}, separators=(",", ":")),
    }
    data_check_string = "\n".join(f"{key}={values[key]}" for key in sorted(values))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    values["hash"] = hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode(values)


def auth(settings: Settings, telegram_id: int) -> dict[str, str]:
    return {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, telegram_id)}


def seed_student(settings: Settings, name: str = "Аня Смирнова") -> int:
    db = SQLiteStorage(settings.database_path)
    student = db.add_student(
        StudentProfile(
            full_name=name,
            grade="11",
            prep_type="ЕГЭ",
            subject="Информатика",
            lesson_price=2000,
            price_60=2000,
            lesson_duration_minutes=60,
            student_telegram="@anya",
            timezone="Europe/Moscow",
            start_date=date(2026, 6, 1),
            status=StudentStatus.ACTIVE.value,
        )
    )
    db.close()
    return int(student.id)


class Fixture:
    def __init__(self, tmp_path: Path) -> None:
        self.settings = make_settings(tmp_path)
        self.student_id = seed_student(self.settings)
        self.db = SQLiteStorage(self.settings.database_path)
        self.now = self.settings.local_now()

    def add_lesson(self, offset_hours: float, **kwargs) -> Lesson:
        params = {
            "student_id": self.student_id,
            "starts_at": self.now + timedelta(hours=offset_hours),
            "duration_minutes": 60,
            "status": LessonStatus.PLANNED.value,
        }
        params.update(kwargs)
        return self.db.add_lesson(Lesson(**params))

    def add_rule(self) -> ScheduleRule:
        return self.db.add_schedule_rule(
            ScheduleRule(
                student_id=self.student_id,
                weekdays=[1, 3],
                lesson_time="18:00",
                duration_minutes=60,
            )
        )

    def close(self) -> None:
        self.db.close()


# --------------------------------------------------------------------------- #
# B. Архив отменённых
# --------------------------------------------------------------------------- #


def test_cancelled_lesson_hidden_from_normal_list_and_shown_in_archive(tmp_path: Path) -> None:
    fixture = Fixture(tmp_path)
    upcoming = fixture.add_lesson(48)
    cancelled = fixture.add_lesson(72, status=LessonStatus.CANCELLED_BY_TEACHER.value)
    fixture.close()

    client = TestClient(create_app(fixture.settings))
    admin = client.get("/api/me", headers=auth(fixture.settings, ADMIN_ID)).json()["admin"]

    calendar_ids = {item["id"] for item in admin["calendar"]}
    archive_ids = {item["id"] for item in admin["calendar_archive"]}

    assert upcoming.id in calendar_ids
    assert cancelled.id not in calendar_ids, "отменённое занятие попало в обычную выдачу"
    assert cancelled.id in archive_ids, "отменённое занятие недоступно в архиве"


def test_cancelled_lesson_hidden_from_student_card_and_shown_in_its_archive(tmp_path: Path) -> None:
    fixture = Fixture(tmp_path)
    cancelled = fixture.add_lesson(72, status=LessonStatus.CANCELLED_BY_TEACHER.value)
    fixture.close()

    client = TestClient(create_app(fixture.settings))
    bundle = client.get(
        f"/api/admin/students/{fixture.student_id}", headers=auth(fixture.settings, ADMIN_ID)
    ).json()

    assert cancelled.id not in {item["id"] for item in bundle["lessons"]}
    assert cancelled.id in {item["id"] for item in bundle["lesson_archive"]}


def test_cancelled_lesson_is_not_picked_up_by_reminders(tmp_path: Path) -> None:
    fixture = Fixture(tmp_path)
    starts_at = datetime(2026, 9, 1, 10, 0)
    fixture.db.add_lesson(
        Lesson(
            student_id=fixture.student_id,
            starts_at=starts_at,
            duration_minutes=60,
            status=LessonStatus.CANCELLED_BY_TEACHER.value,
        )
    )
    window_start = starts_at - timedelta(seconds=30)
    window_end = window_start + timedelta(seconds=70)
    found = fixture.db.list_lessons_between(window_start, window_end, include_cancelled=False)
    fixture.close()

    assert found == [], "отменённое занятие попало в выборку напоминаний"


# --------------------------------------------------------------------------- #
# C. Очистка стабильного расписания
# --------------------------------------------------------------------------- #


def test_cleanup_skips_conducted_past_and_paid_lessons(tmp_path: Path) -> None:
    fixture = Fixture(tmp_path)
    fixture.add_rule()
    future_plain = fixture.add_lesson(48)
    future_pending = fixture.add_lesson(50, status=LessonStatus.PENDING_CONFIRMATION.value)
    past_planned = fixture.add_lesson(-48)
    conducted = fixture.add_lesson(-24, status=LessonStatus.CONDUCTED.value)
    paid_flag = fixture.add_lesson(52, payment_status=LessonPaymentStatus.CONFIRMED.value)
    with_payment = fixture.add_lesson(54)
    fixture.db.add_payment(
        Payment(
            student_id=fixture.student_id,
            lesson_id=with_payment.id,
            amount=2000,
            lessons_count=1,
            sender_role=Role.STUDENT.value,
            status=PaymentStatus.CONFIRMED.value,
        )
    )

    plan = apply_cleanup(fixture.db, fixture.student_id, fixture.now)
    statuses = {
        "future_plain": fixture.db.get_lesson(int(future_plain.id)).status,
        "future_pending": fixture.db.get_lesson(int(future_pending.id)).status,
        "past_planned": fixture.db.get_lesson(int(past_planned.id)).status,
        "conducted": fixture.db.get_lesson(int(conducted.id)).status,
        "paid_flag": fixture.db.get_lesson(int(paid_flag.id)).status,
        "with_payment": fixture.db.get_lesson(int(with_payment.id)).status,
    }
    remaining_rules = len(fixture.db.list_schedule_rules(fixture.student_id))
    total_rows = fixture.db.conn.execute("SELECT COUNT(*) AS n FROM lessons").fetchone()["n"]
    fixture.close()

    assert len(plan.cancellable) == 2
    assert statuses["future_plain"] == LessonStatus.CANCELLED_BY_TEACHER.value
    assert statuses["future_pending"] == LessonStatus.CANCELLED_BY_TEACHER.value
    assert statuses["past_planned"] == LessonStatus.PLANNED.value, "прошедшее занятие тронуто"
    assert statuses["conducted"] == LessonStatus.CONDUCTED.value, "проведённое занятие тронуто"
    assert statuses["paid_flag"] == LessonStatus.PLANNED.value, "оплаченное занятие тронуто"
    assert statuses["with_payment"] == LessonStatus.PLANNED.value, "занятие с платежом тронуто"
    assert remaining_rules == 0, "правила стабильного расписания не удалены"
    assert total_rows == 6, "строки занятий удалялись, а это запрещено"


def test_preview_and_apply_report_the_same_numbers(tmp_path: Path) -> None:
    fixture = Fixture(tmp_path)
    fixture.add_rule()
    fixture.add_lesson(48)
    fixture.add_lesson(72)
    fixture.add_lesson(-24, status=LessonStatus.CONDUCTED.value)
    fixture.add_lesson(96, payment_status=LessonPaymentStatus.CONFIRMED.value)
    fixture.close()

    client = TestClient(create_app(fixture.settings))
    headers = auth(fixture.settings, ADMIN_ID)
    preview = client.get(
        f"/api/admin/students/{fixture.student_id}/schedule-cleanup", headers=headers
    ).json()
    applied = client.post(
        f"/api/admin/students/{fixture.student_id}/schedule-cleanup", headers=headers
    ).json()

    assert preview["cancel_count"] == 2
    assert preview["rules"] == 1
    assert applied["cancel_count"] == preview["cancel_count"]
    assert applied["skipped_total"] == preview["skipped_total"]
    assert applied["rules"] == preview["rules"]
    assert preview["first_date"] is not None and preview["last_date"] is not None


def test_cleanup_is_idempotent(tmp_path: Path) -> None:
    fixture = Fixture(tmp_path)
    fixture.add_rule()
    fixture.add_lesson(48)
    fixture.add_lesson(72)
    fixture.close()

    client = TestClient(create_app(fixture.settings))
    headers = auth(fixture.settings, ADMIN_ID)
    first = client.post(
        f"/api/admin/students/{fixture.student_id}/schedule-cleanup", headers=headers
    ).json()
    second = client.post(
        f"/api/admin/students/{fixture.student_id}/schedule-cleanup", headers=headers
    ).json()

    assert first["cancel_count"] == 2
    assert second["cancel_count"] == 0, "повторная очистка не идемпотентна"
    assert second["skipped_total"] == 0, "уже отменённые не должны считаться пропущенными"


def test_cleanup_rejects_non_tutor(tmp_path: Path) -> None:
    fixture = Fixture(tmp_path)
    fixture.add_rule()
    lesson = fixture.add_lesson(48)
    fixture.db.upsert_user(
        UserAccount(telegram_id=STUDENT_TG_ID, role=Role.STUDENT.value, student_id=fixture.student_id)
    )
    fixture.close()

    client = TestClient(create_app(fixture.settings))
    headers = auth(fixture.settings, STUDENT_TG_ID)

    preview = client.get(f"/api/admin/students/{fixture.student_id}/schedule-cleanup", headers=headers)
    applied = client.post(f"/api/admin/students/{fixture.student_id}/schedule-cleanup", headers=headers)

    db = SQLiteStorage(fixture.settings.database_path)
    status = db.get_lesson(int(lesson.id)).status
    rules = len(db.list_schedule_rules(fixture.student_id))
    db.close()

    assert preview.status_code == 403
    assert applied.status_code == 403
    assert status == LessonStatus.PLANNED.value
    assert rules == 1


def test_cleanup_of_unknown_student_is_rejected(tmp_path: Path) -> None:
    fixture = Fixture(tmp_path)
    fixture.close()
    client = TestClient(create_app(fixture.settings))
    headers = auth(fixture.settings, ADMIN_ID)

    assert client.get("/api/admin/students/9999/schedule-cleanup", headers=headers).status_code == 404
    assert client.post("/api/admin/students/9999/schedule-cleanup", headers=headers).status_code == 404


def test_cancelled_by_cleanup_lands_in_archive(tmp_path: Path) -> None:
    fixture = Fixture(tmp_path)
    fixture.add_rule()
    lesson = fixture.add_lesson(48)
    fixture.close()

    client = TestClient(create_app(fixture.settings))
    headers = auth(fixture.settings, ADMIN_ID)
    client.post(f"/api/admin/students/{fixture.student_id}/schedule-cleanup", headers=headers)
    admin = client.get("/api/me", headers=headers).json()["admin"]

    assert lesson.id not in {item["id"] for item in admin["calendar"]}
    assert lesson.id in {item["id"] for item in admin["calendar_archive"]}


def test_plan_cleanup_does_not_mutate_anything(tmp_path: Path) -> None:
    fixture = Fixture(tmp_path)
    fixture.add_rule()
    lesson = fixture.add_lesson(48)

    plan_cleanup(fixture.db, fixture.student_id, fixture.now)
    status = fixture.db.get_lesson(int(lesson.id)).status
    rules = len(fixture.db.list_schedule_rules(fixture.student_id))
    fixture.close()

    assert status == LessonStatus.PLANNED.value
    assert rules == 1


def test_build_endpoint_reports_commit(tmp_path: Path, monkeypatch) -> None:
    settings = make_settings(tmp_path)
    client = TestClient(create_app(settings))

    monkeypatch.delenv("BUILD_COMMIT", raising=False)
    assert client.get("/api/build").json()["commit"] == "unknown"

    monkeypatch.setenv("BUILD_COMMIT", "abc123")
    assert client.get("/api/build").json()["commit"] == "abc123"
