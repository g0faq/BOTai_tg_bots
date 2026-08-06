from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, date, datetime, time, timedelta
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
from tutor_bot.domain.models import (
    Homework,
    Lesson,
    Payment,
    PrepTopic,
    StudentProfile,
    UserAccount,
)
from tutor_bot.services.heartbeat import (
    STALE_AFTER_SECONDS,
    heartbeat_path,
    write_heartbeat,
)
from tutor_bot.storage.sqlite import SQLiteStorage
from tutor_bot.webapp import create_app, verify_init_data


def make_settings(tmp_path: Path) -> Settings:
    return Settings(
        bot_token="123456:test-token",
        admin_telegram_ids=[900],
        teacher_chat_url="https://t.me/teacher",
        database_path=str(tmp_path / "bot.sqlite3"),
        timezone="Europe/Moscow",
        default_lesson_price=2000,
        default_lesson_duration_minutes=60,
        default_payment_package_size=4,
        low_balance_threshold=1,
        reminder_minutes_before_lesson=5,
        working_days=[1, 2, 3, 4, 5, 6],
        working_start=time(10, 0),
        working_end=time(22, 0),
        slot_step_minutes=30,
        webapp_url="http://127.0.0.1:8000",
    )


def signed_init_data(bot_token: str, user_id: int, username: str = "") -> str:
    user = {"id": user_id, "first_name": "Test"}
    if username:
        user["username"] = username
    values = {
        "auth_date": "1780000000",
        "query_id": "AAEAAAE",
        "user": json.dumps(user, separators=(",", ":")),
    }
    data_check_string = "\n".join(f"{key}={values[key]}" for key in sorted(values))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    values["hash"] = hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode(values)


def seed_student(settings: Settings, telegram_id: int = 101) -> int:
    db = SQLiteStorage(settings.database_path)
    student = db.add_student(
        StudentProfile(
            full_name="Аня Смирнова",
            grade="10",
            prep_type="ЕГЭ",
            subject="Информатика",
            goal="90+ баллов",
            current_level="средний",
            lesson_price=2000,
            price_60=2000,
            price_90=3000,
            price_120=4000,
            lesson_duration_minutes=60,
            student_telegram="@anya",
            timezone="Europe/Moscow",
            start_date=date(2026, 6, 1),
            status=StudentStatus.ACTIVE.value,
            balance_lessons=2,
            progress_current=4,
            progress_goal=27,
        )
    )
    db.upsert_user(
        UserAccount(
            telegram_id=telegram_id,
            role=Role.STUDENT.value,
            student_id=student.id,
            username="anya",
            full_name="Аня",
        )
    )
    db.add_homework(Homework(student_id=student.id, text="Решить задачи 1-5"))
    db.close()
    return int(student.id)


def test_verify_init_data_accepts_signed_payload() -> None:
    init_data = signed_init_data("123456:test-token", 101)

    assert verify_init_data(init_data, "123456:test-token")["id"] == 101


def test_verify_init_data_rejects_tampered_payload() -> None:
    init_data = signed_init_data("123456:test-token", 101).replace("101", "102")

    try:
        verify_init_data(init_data, "123456:test-token")
    except Exception as error:
        assert getattr(error, "status_code", None) == 401
    else:
        raise AssertionError("tampered initData must be rejected")


def test_version_endpoint_disables_cache_for_stale_clients(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    client = TestClient(create_app(settings))

    response = client.get("/api/version", headers={"X-App-Version": "old-client"})

    assert response.status_code == 200
    assert response.json()["version"]
    assert response.headers["cache-control"] == "no-cache, no-store, must-revalidate"
    assert response.headers["clear-site-data"] == '"cache"'
    assert response.headers["x-app-version"] == response.json()["version"]

    fresh = client.get("/api/version", headers={"X-App-Version": response.json()["version"]})
    assert "clear-site-data" not in fresh.headers


def test_healthz_endpoint_is_lightweight(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    client = TestClient(create_app(settings))

    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.headers["x-app-version"] == response.json()["version"]
    assert "clear-site-data" not in response.headers


def test_healthz_reports_reminder_loop_state(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    client = TestClient(create_app(settings))

    unknown = client.get("/healthz").json()
    assert unknown["reminder_status"] == "unknown"
    assert unknown["reminder_last_run_ts"] is None
    assert unknown["reminder_age_seconds"] is None

    write_heartbeat(settings.database_path)
    fresh = client.get("/healthz").json()

    assert fresh["reminder_status"] == "ok"
    assert fresh["reminder_last_run_ts"] is not None
    assert fresh["reminder_age_seconds"] < 5


def test_healthz_stays_200_when_reminder_loop_is_stale(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    client = TestClient(create_app(settings))
    stale_ts = datetime.now(UTC) - timedelta(seconds=STALE_AFTER_SECONDS + 60)
    heartbeat_path(settings.database_path).write_text(
        json.dumps({"ts": stale_ts.isoformat(), "last_error": "OperationalError: database is locked"}),
        encoding="utf-8",
    )

    response = client.get("/healthz")

    # 503 могло бы увести Amvera в цикл перезапусков прода — статус только в теле.
    assert response.status_code == 200
    assert response.json()["reminder_status"] == "stale"
    assert response.json()["status"] == "ok"


def test_student_dashboard_and_payment_flow(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    seed_student(settings)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    response = client.get("/api/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["dashboard"]["student"]["full_name"] == "Аня Смирнова"

    payment = client.post(
        "/api/payment",
        headers=headers,
        json={"amount": 8000, "lessons_count": 4, "comment": "июнь"},
    )
    assert payment.status_code == 200
    assert payment.json()["payment"]["status"] == "ожидает подтверждения"


def test_browser_invite_opens_student_dashboard_without_telegram(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}

    invite = client.post(
        f"/api/admin/students/{student_id}/browser-invites",
        headers=headers,
        json={"role": "student", "invite_days": 30, "session_days": 180},
    )

    assert invite.status_code == 200
    token = invite.json()["url"].rstrip("/").rsplit("/", 1)[-1]
    login = client.get(f"/login/{token}", follow_redirects=False)
    assert login.status_code == 303
    assert "tutor_browser_session" in login.headers["set-cookie"]

    response = client.get("/api/me")
    assert response.status_code == 200
    payload = response.json()
    assert payload["role"] == "student"
    assert payload["dashboard"]["student"]["id"] == student_id

    second_login = client.get(f"/login/{token}", follow_redirects=False)
    assert second_login.status_code == 303


def test_tutor_browser_invite_opens_admin_dashboard_without_telegram(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    seed_student(settings)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}

    invite = client.post(
        "/api/admin/browser-invites",
        headers=headers,
        json={"invite_days": 30, "session_days": 180},
    )

    assert invite.status_code == 200
    token = invite.json()["url"].rstrip("/").rsplit("/", 1)[-1]
    login = client.get(f"/login/tutor/{token}", follow_redirects=False)
    assert login.status_code == 303
    assert "tutor_browser_session" in login.headers["set-cookie"]

    response = client.get("/api/me")
    assert response.status_code == 200
    payload = response.json()
    assert payload["role"] == "tutor"
    assert "admin" in payload

    second_login = client.get(f"/login/tutor/{token}", follow_redirects=False)
    assert second_login.status_code == 303


def test_browser_invite_prefers_primary_domain_over_request_host(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    settings.webapp_url = "https://g0faqtutorbot.ru"
    settings.webapp_url_aliases = [
        "http://5-42-109-83.sslip.io",
        "https://g0faqtutorbot.ru:8443",
        "https://assistance-cabin-folder-leader.trycloudflare.com",
    ]
    student_id = seed_student(settings)
    client = TestClient(create_app(settings))
    headers = {
        "X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900),
        "host": "assistance-cabin-folder-leader.trycloudflare.com",
        "x-forwarded-proto": "https",
    }

    invite = client.post(
        f"/api/admin/students/{student_id}/browser-invites",
        headers=headers,
        json={"role": "student", "invite_days": 30, "session_days": 180},
    )

    assert invite.status_code == 200
    payload = invite.json()
    assert payload["url"].startswith("https://assistance-cabin-folder-leader.trycloudflare.com/login/")
    assert payload["urls"][0].startswith("https://assistance-cabin-folder-leader.trycloudflare.com/login/")
    assert payload["urls"][1].startswith("https://g0faqtutorbot.ru/login/")
    assert payload["urls"][2].startswith("http://5-42-109-83.sslip.io/login/")
    assert payload["urls"][3].startswith("https://g0faqtutorbot.ru:8443/login/")


def test_admin_student_cards_include_full_stats(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=datetime.combine(date.today() - timedelta(days=2), time(10, 0)),
            duration_minutes=60,
            status=LessonStatus.CONDUCTED.value,
            payment_status=LessonPaymentStatus.CONFIRMED.value,
            payment_amount=2000,
        )
    )
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}

    response = client.get("/api/me", headers=headers)

    assert response.status_code == 200
    student = response.json()["admin"]["students"][0]
    assert student["stats"]["conducted"] == 1
    assert student["stats"]["paid_lessons"] == 1


def test_admin_student_status_uses_historical_unpaid_lessons_even_with_advance(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=datetime.combine(date.today() - timedelta(days=1), time(10, 0)),
            duration_minutes=60,
            status=LessonStatus.CONDUCTED.value,
            payment_status=LessonPaymentStatus.UNPAID.value,
            payment_amount=2000,
        )
    )
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}

    response = client.get("/api/me", headers=headers)

    assert response.status_code == 200
    payload = response.json()["admin"]
    student = payload["students"][0]
    assert student["balance_lessons"] == 2
    assert student["stats"]["unpaid_lessons"] == 1
    assert payload["finances"]["debt_amount"] == 2000


def test_admin_expected_income_is_split_by_today_and_week(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    week_future = max(today + timedelta(days=1), week_start + timedelta(days=4))
    if week_future >= week_start + timedelta(days=7):
        week_future = today
    db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=datetime.combine(today - timedelta(days=1), time(10, 0)),
            duration_minutes=60,
            status=LessonStatus.CONDUCTED.value,
            payment_status=LessonPaymentStatus.UNPAID.value,
            payment_amount=2000,
        )
    )
    db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=datetime.combine(today, time(12, 0)),
            duration_minutes=60,
            status=LessonStatus.PLANNED.value,
            payment_status=LessonPaymentStatus.NOT_MARKED.value,
            payment_amount=2000,
        )
    )
    db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=datetime.combine(week_future, time(14, 0)),
            duration_minutes=90,
            status=LessonStatus.PLANNED.value,
            payment_status=LessonPaymentStatus.NOT_MARKED.value,
            payment_amount=3000,
        )
    )
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}

    response = client.get("/api/me", headers=headers)

    assert response.status_code == 200
    finances = response.json()["admin"]["finances"]
    assert finances["debt_amount"] == 2000
    assert finances["expected_today_income"] == (5000 if week_future == today else 2000)
    assert finances["expected_week_income"] >= 2000
    assert finances["expected_week_income"] != finances["debt_amount"]


def test_advance_auto_paid_lesson_does_not_count_as_today_income(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    yesterday = datetime.combine(date.today() - timedelta(days=1), time(12, 0))
    db.add_payment(
        Payment(
            student_id=student_id,
            amount=8000,
            lessons_count=4,
            sender_role=Role.ADMIN.value,
            status=PaymentStatus.CONFIRMED.value,
            created_at=yesterday,
            confirmed_at=yesterday,
        )
    )
    db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=datetime.combine(date.today(), time(10, 0)),
            duration_minutes=60,
            status=LessonStatus.CONDUCTED.value,
            payment_status=LessonPaymentStatus.CONFIRMED.value,
            payment_marked_by="auto",
            payment_confirmed_at=datetime.combine(date.today(), time(11, 0)),
            payment_amount=2000,
        )
    )
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}

    response = client.get("/api/me", headers=headers)

    assert response.status_code == 200
    finances = response.json()["admin"]["finances"]
    assert finances["today_income"] == 0
    assert finances["month_income"] == 8000
    assert finances["advances"][0]["remaining_lessons"] == 3


def test_advance_remaining_lessons_subtracts_old_debt_and_conducted_lessons(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    advance_date = datetime.combine(date.today(), time(12, 0))
    debt_lesson = db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=advance_date - timedelta(days=1),
            duration_minutes=60,
            status=LessonStatus.CONDUCTED.value,
            payment_status=LessonPaymentStatus.UNPAID.value,
            payment_amount=2000,
        )
    )
    later_lesson = db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=advance_date + timedelta(days=1),
            duration_minutes=60,
            status=LessonStatus.CONDUCTED.value,
            payment_status=LessonPaymentStatus.NOT_MARKED.value,
            payment_amount=2000,
        )
    )
    db.add_payment(
        Payment(
            student_id=student_id,
            amount=8000,
            lessons_count=4,
            sender_role=Role.ADMIN.value,
            status=PaymentStatus.CONFIRMED.value,
            created_at=advance_date,
            confirmed_at=advance_date,
        )
    )
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}

    response = client.get("/api/me", headers=headers)

    assert response.status_code == 200
    finances = response.json()["admin"]["finances"]
    assert finances["advances"][0]["remaining_lessons"] == 2
    assert finances["advances"][0]["debt_covered_amount"] == 2000
    assert finances["advances"][0]["lesson_covered_amount"] == 2000

    db = SQLiteStorage(settings.database_path)
    assert db.get_lesson(debt_lesson.id).payment_status == LessonPaymentStatus.CONFIRMED.value
    assert db.get_lesson(later_lesson.id).payment_marked_by == "advance"
    assert db.get_student(student_id).balance_lessons == 2
    db.close()


def test_advance_subtracts_past_planned_lessons(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    advance_date = datetime.combine(date.today() - timedelta(days=5), time(12, 0))
    db.add_payment(
        Payment(
            student_id=student_id,
            amount=10000,
            lessons_count=5,
            sender_role=Role.ADMIN.value,
            status=PaymentStatus.CONFIRMED.value,
            created_at=advance_date,
            confirmed_at=advance_date,
        )
    )
    db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=advance_date + timedelta(days=1),
            duration_minutes=60,
            status=LessonStatus.PLANNED.value,
            payment_status=LessonPaymentStatus.NOT_MARKED.value,
            payment_amount=2000,
        )
    )
    db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=advance_date + timedelta(days=2),
            duration_minutes=60,
            status=LessonStatus.PLANNED.value,
            payment_status=LessonPaymentStatus.NOT_MARKED.value,
            payment_amount=2000,
        )
    )
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}

    response = client.get("/api/me", headers=headers)

    assert response.status_code == 200
    finances = response.json()["admin"]["finances"]
    assert finances["advances"][0]["remaining_lessons"] == 3


def test_advance_subtracts_confirmed_admin_paid_lessons(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    advance_date = datetime.combine(date.today() - timedelta(days=3), time(12, 0))
    db.add_payment(
        Payment(
            student_id=student_id,
            amount=10000,
            lessons_count=5,
            sender_role=Role.ADMIN.value,
            status=PaymentStatus.CONFIRMED.value,
            created_at=advance_date,
            confirmed_at=advance_date,
        )
    )
    db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=advance_date + timedelta(hours=1),
            duration_minutes=60,
            status=LessonStatus.CONDUCTED.value,
            payment_status=LessonPaymentStatus.CONFIRMED.value,
            payment_marked_by=Role.ADMIN.value,
            payment_amount=2000,
        )
    )
    db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=advance_date + timedelta(days=1),
            duration_minutes=60,
            status=LessonStatus.CONDUCTED.value,
            payment_status=LessonPaymentStatus.CONFIRMED.value,
            payment_amount=2000,
        )
    )
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}

    response = client.get("/api/me", headers=headers)

    assert response.status_code == 200
    finances = response.json()["admin"]["finances"]
    assert finances["advances"][0]["remaining_lessons"] == 3


def test_advance_remaining_uses_package_lesson_price(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    student = db.get_student(student_id)
    student.price_60 = 700
    student.lesson_price = 700
    db.update_student(student)
    advance_date = datetime.combine(date.today() - timedelta(days=3), time(12, 0))
    db.add_payment(
        Payment(
            student_id=student_id,
            amount=5250,
            lessons_count=5,
            sender_role=Role.ADMIN.value,
            status=PaymentStatus.CONFIRMED.value,
            created_at=advance_date,
            confirmed_at=advance_date,
        )
    )
    for offset in range(3):
        db.add_lesson(
            Lesson(
                student_id=student_id,
                starts_at=advance_date + timedelta(hours=offset + 1),
                duration_minutes=90,
                status=LessonStatus.CONDUCTED.value,
                payment_status=LessonPaymentStatus.CONFIRMED.value,
                payment_marked_by=Role.ADMIN.value,
                payment_amount=1050,
            )
        )
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}

    response = client.get("/api/me", headers=headers)

    assert response.status_code == 200
    finances = response.json()["admin"]["finances"]
    assert finances["advances"][0]["remaining_lessons"] == 2


def test_admin_can_override_advance_remaining_lessons(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    payment = db.add_payment(
        Payment(
            student_id=student_id,
            amount=10000,
            lessons_count=5,
            sender_role=Role.ADMIN.value,
            status=PaymentStatus.CONFIRMED.value,
            created_at=datetime.combine(date.today() - timedelta(days=5), time(12, 0)),
            confirmed_at=datetime.combine(date.today() - timedelta(days=5), time(12, 0)),
        )
    )
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}

    response = client.patch(
        f"/api/admin/advances/{payment.id}",
        headers=headers,
        json={"remaining_lessons": 2, "lessons_count": 5, "amount": 10000},
    )

    assert response.status_code == 200
    assert response.json()["student"]["balance_lessons"] == 2
    dashboard = client.get("/api/me", headers=headers)
    advance = dashboard.json()["admin"]["finances"]["advances"][0]
    assert advance["remaining_lessons"] == 2
    assert advance["manual_remaining_lessons"] == 2


def test_student_can_book_available_slot(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    seed_student(settings)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}
    slot = datetime.combine(date.today() + timedelta(days=1), time(11, 0))
    while slot.isoweekday() == 7:
        slot += timedelta(days=1)

    response = client.post(
        "/api/book",
        headers=headers,
        json={"starts_at": slot.isoformat(), "duration_minutes": 60},
    )

    assert response.status_code == 200
    assert response.json()["lesson"]["starts_at"].startswith(slot.date().isoformat())
    assert response.json()["lesson"]["status"] == LessonStatus.PENDING_CONFIRMATION.value


def test_student_booking_uses_student_timezone_for_teacher_slot(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    student = db.get_student(student_id)
    student.timezone = "Etc/GMT-4"
    db.update_student(student)
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}
    local_slot = datetime.combine(date.today() + timedelta(days=1), time(18, 0))
    while local_slot.isoweekday() == 7:
        local_slot += timedelta(days=1)

    response = client.post(
        "/api/book",
        headers=headers,
        json={"starts_at": local_slot.isoformat(), "duration_minutes": 60},
    )

    assert response.status_code == 200
    lesson = response.json()["lesson"]
    assert lesson["starts_at"][11:16] == "17:00"
    assert lesson["student_starts_at"][11:16] == "18:00"


def test_admin_created_lesson_requires_student_confirmation(tmp_path: Path, monkeypatch) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    sent_notifications = []
    monkeypatch.setattr(
        "tutor_bot.webapp.notify_student_users_sync",
        lambda state, student_id, text, reply_markup=None: sent_notifications.append((student_id, text, reply_markup)),
    )
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}
    slot = datetime.combine(date.today() + timedelta(days=1), time(12, 0))
    while slot.isoweekday() == 7:
        slot += timedelta(days=1)

    response = client.post(
        "/api/admin/lessons",
        headers=headers,
        json={"student_id": student_id, "starts_at": slot.isoformat(), "duration_minutes": 60},
    )

    assert response.status_code == 200
    lesson = response.json()["lesson"]
    assert lesson["status"] == LessonStatus.PENDING_CONFIRMATION.value
    assert sent_notifications
    assert sent_notifications[0][0] == student_id
    assert sent_notifications[0][2]["inline_keyboard"][0][0]["callback_data"] == f"student_lesson_confirm:{lesson['id']}"


def test_admin_lesson_duplicate_slot_is_rejected(tmp_path: Path, monkeypatch) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    monkeypatch.setattr("tutor_bot.webapp.notify_student_users_sync", lambda *args, **kwargs: None)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}
    slot = datetime.combine(date.today() + timedelta(days=1), time(12, 0))
    while slot.isoweekday() == 7:
        slot += timedelta(days=1)
    payload = {"student_id": student_id, "starts_at": slot.isoformat(), "duration_minutes": 60}

    first = client.post("/api/admin/lessons", headers=headers, json=payload)
    second = client.post("/api/admin/lessons", headers=headers, json=payload)

    assert first.status_code == 200
    assert second.status_code == 409
    db = SQLiteStorage(settings.database_path)
    try:
        lessons = [lesson for lesson in db.list_student_lessons(student_id, limit=20) if lesson.starts_at == slot]
        assert len(lessons) == 1
    finally:
        db.close()


def test_admin_can_list_and_delete_closed_slots(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    seed_student(settings)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}
    starts_at = datetime.combine(date.today() + timedelta(days=1), time(15, 0))
    ends_at = starts_at + timedelta(hours=2)

    created = client.post(
        "/api/admin/closed-slots",
        headers=headers,
        json={"starts_at": starts_at.isoformat(), "ends_at": ends_at.isoformat(), "reason": "Встреча"},
    )

    assert created.status_code == 200
    slot_id = created.json()["slot"]["id"]
    dashboard = client.get("/api/me", headers=headers)
    assert dashboard.status_code == 200
    assert any(slot["id"] == slot_id and slot["reason"] == "Встреча" for slot in dashboard.json()["admin"]["closed_slots"])

    deleted = client.delete(f"/api/admin/closed-slots/{slot_id}", headers=headers)

    assert deleted.status_code == 200
    dashboard_after_delete = client.get("/api/me", headers=headers)
    assert all(slot["id"] != slot_id for slot in dashboard_after_delete.json()["admin"]["closed_slots"])


def test_admin_can_delete_lesson(tmp_path: Path, monkeypatch) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    monkeypatch.setattr("tutor_bot.webapp.notify_student_users_sync", lambda *args, **kwargs: None)
    db = SQLiteStorage(settings.database_path)
    lesson = db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=datetime.combine(date.today() + timedelta(days=1), time(12, 0)),
            duration_minutes=60,
        )
    )
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}

    response = client.delete(f"/api/admin/lessons/{lesson.id}", headers=headers)

    assert response.status_code == 200
    db = SQLiteStorage(settings.database_path)
    try:
        assert db.get_lesson(lesson.id) is None
    finally:
        db.close()


def test_student_can_confirm_admin_created_lesson(tmp_path: Path, monkeypatch) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    monkeypatch.setattr("tutor_bot.webapp.notify_admins_sync", lambda *args, **kwargs: None)
    db = SQLiteStorage(settings.database_path)
    lesson = db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=datetime.combine(date.today() + timedelta(days=1), time(12, 0)),
            duration_minutes=60,
            status=LessonStatus.PENDING_CONFIRMATION.value,
        )
    )
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    response = client.post(f"/api/lessons/{lesson.id}/confirm", headers=headers)

    assert response.status_code == 200
    assert response.json()["lesson"]["status"] == LessonStatus.PLANNED.value


def test_admin_create_student_reuses_existing_contact(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    seed_student(settings)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}

    first = client.post(
        "/api/admin/students",
        headers=headers,
        json={"full_name": "Аня Смирнова", "student_telegram": "@anya", "lesson_price": 2500},
    )
    second = client.post(
        "/api/admin/students",
        headers=headers,
        json={"full_name": "Аня Смирнова", "student_telegram": "@anya", "lesson_price": 2500},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["student"]["id"] == second.json()["student"]["id"]
    db = SQLiteStorage(settings.database_path)
    try:
        assert len(db.list_students()) == 1
    finally:
        db.close()


def test_admin_create_student_reuses_existing_identity_without_contact(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}
    payload = {
        "full_name": "Коля Иванов",
        "grade": "9",
        "subject": "Информатика",
        "prep_type": "ОГЭ",
        "lesson_price": 2000,
    }

    first = client.post("/api/admin/students", headers=headers, json=payload)
    second = client.post("/api/admin/students", headers=headers, json=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["student"]["id"] == second.json()["student"]["id"]
    db = SQLiteStorage(settings.database_path)
    try:
        assert len(db.list_students()) == 1
    finally:
        db.close()


def test_admin_homework_creation_notifies_student(tmp_path: Path, monkeypatch) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    sent_notifications = []
    monkeypatch.setattr(
        "tutor_bot.webapp.notify_student_users_sync",
        lambda state, student_id, text, reply_markup=None: sent_notifications.append((student_id, text, reply_markup)),
    )
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}

    response = client.post(
        "/api/admin/homework",
        headers=headers,
        json={"student_id": student_id, "title": "Тип 2", "text": "Прорешать второй тип"},
    )

    assert response.status_code == 200
    assert sent_notifications
    assert sent_notifications[0][0] == student_id
    assert "Новое домашнее задание" in sent_notifications[0][1]
    assert "Прорешать второй тип" in sent_notifications[0][1]


def test_admin_can_delete_homework_for_everyone(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    seed_student(settings)
    client = TestClient(create_app(settings))
    admin_headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}
    student_headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    homework_id = client.get("/api/me", headers=admin_headers).json()["admin"]["homeworks"][0]["id"]
    forbidden = client.delete(f"/api/admin/homework/{homework_id}", headers=student_headers)
    assert forbidden.status_code == 403

    deleted = client.delete(f"/api/admin/homework/{homework_id}", headers=admin_headers)
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True
    assert client.get("/api/me", headers=admin_headers).json()["admin"]["homeworks"] == []
    assert client.get("/api/me", headers=student_headers).json()["dashboard"]["homeworks"] == []


def test_student_can_view_available_slots(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    seed_student(settings)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    response = client.get("/api/available-slots?duration_minutes=60&days=3", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["duration_minutes"] == 60
    assert isinstance(body["slots"], list)
    assert body["slots"]
    assert {"starts_at", "ends_at", "duration_minutes"} <= set(body["slots"][0])


def test_student_in_msk_plus_six_can_view_sunday_slot(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    settings.working_days = [1, 2, 3, 4, 5, 6, 7]
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    student = db.get_student(student_id)
    student.timezone = "Etc/GMT-9"
    db.update_student(student)
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}
    sunday = date.today() + timedelta(days=(7 - date.today().isoweekday()) % 7 or 7)

    response = client.get("/api/available-slots?duration_minutes=60&days=14", headers=headers)

    assert response.status_code == 200
    expected_teacher_start = f"{sunday.isoformat()}T12:00:00"
    slot = next(item for item in response.json()["slots"] if item["teacher_starts_at"] == expected_teacher_start)
    assert slot["student_starts_at"] == f"{sunday.isoformat()}T18:00:00"


def test_busy_booking_returns_suggested_slots(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    busy_slot = datetime.combine(date.today() + timedelta(days=1), time(11, 0))
    while busy_slot.isoweekday() == 7:
        busy_slot += timedelta(days=1)
    db = SQLiteStorage(settings.database_path)
    db.add_lesson(Lesson(student_id=student_id, starts_at=busy_slot, duration_minutes=60))
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    response = client.post(
        "/api/book",
        headers=headers,
        json={"starts_at": busy_slot.isoformat(), "duration_minutes": 60},
    )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["message"] == "Это время уже занято. Выбери другое свободное окно."
    assert detail["conflicts"]
    assert detail["suggested_slots"]


def test_student_can_update_task_progress(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    response = client.patch(
        f"/api/students/{student_id}/progress",
        headers=headers,
        json={"task_number": 3, "knowledge_level": 9},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["student"]["progress_current"] == 1
    assert body["topics"][0]["title"] == "Задание 3"
    assert body["topics"][0]["knowledge_level"] == 9


def test_student_can_update_task_progress_comment(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    response = client.patch(
        f"/api/students/{student_id}/progress",
        headers=headers,
        json={"task_number": 2, "knowledge_level": 6, "comment": "прорешать второй тип"},
    )

    assert response.status_code == 200
    topic = response.json()["topics"][0]
    assert topic["title"] == "Задание 2"
    assert topic["comment"] == "прорешать второй тип"


def test_student_can_delete_progress_note_without_deleting_topic(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    topic = db.upsert_prep_topic(
        PrepTopic(student_id=student_id, title="Задание 2", knowledge_level=8, comment="заметка")
    )
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    response = client.delete(
        f"/api/students/{student_id}/progress/{topic.id}/note",
        headers=headers,
    )

    assert response.status_code == 200
    saved = response.json()["topics"][0]
    assert saved["knowledge_level"] == 8
    assert saved["comment"] == ""


def test_student_can_add_progress_note_without_changing_level(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    db.upsert_prep_topic(PrepTopic(student_id=student_id, title="Задание 4", knowledge_level=8))
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    response = client.patch(
        f"/api/students/{student_id}/progress",
        headers=headers,
        json={"task_number": 4, "comment": "все супер"},
    )

    assert response.status_code == 200
    topic = response.json()["topics"][0]
    assert topic["knowledge_level"] == 8
    assert topic["comment"] == "все супер"


def test_student_can_create_and_toggle_plan_item(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    created = client.post(
        f"/api/students/{student_id}/plan",
        headers=headers,
        json={"title": "Прорешать второй тип", "deadline": "2026-06-20", "comment": "10 задач"},
    )

    assert created.status_code == 200
    item = created.json()["item"]
    assert item["deadline"] == "2026-06-20"
    toggled = client.patch(
        f"/api/students/{student_id}/plan/{item['id']}",
        headers=headers,
        json={"status": "выполнено"},
    )
    assert toggled.status_code == 200
    assert toggled.json()["item"]["status"] == "выполнено"


def test_student_can_update_custom_progress_topic(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    student = db.get_student(student_id)
    student.prep_type = "Python"
    student.subject = ""
    student.progress_goal = 0
    db.update_student(student)
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    response = client.patch(
        f"/api/students/{student_id}/progress",
        headers=headers,
        json={"title": "Лабораторная работа 1", "knowledge_level": 8},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["student"]["progress_current"] == 1
    assert body["topics"][0]["title"] == "Лабораторная работа 1"
    assert body["topics"][0]["knowledge_level"] == 8


def test_student_can_delete_custom_progress_topic(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    student = db.get_student(student_id)
    student.prep_type = "Python"
    student.subject = ""
    student.progress_goal = 2
    student.progress_current = 2
    db.update_student(student)
    topic = db.upsert_prep_topic(
        PrepTopic(student_id=student_id, title="Лабораторная работа 1", knowledge_level=8)
    )
    db.upsert_prep_topic(PrepTopic(student_id=student_id, title="Списки", knowledge_level=6))
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    response = client.delete(
        f"/api/students/{student_id}/progress/{topic.id}",
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert [item["title"] for item in body["topics"]] == ["Списки"]
    assert body["student"]["progress_goal"] == 1
    assert body["student"]["progress_current"] == 0


def test_student_cannot_delete_exam_progress_task(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    topic = db.upsert_prep_topic(PrepTopic(student_id=student_id, title="Задание 2", knowledge_level=8))
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    response = client.delete(
        f"/api/students/{student_id}/progress/{topic.id}",
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Экзаменационные задания нельзя удалять"


def test_student_dashboard_sorts_progress_topics_by_task_number(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    db.upsert_prep_topic(PrepTopic(student_id=student_id, title="Задание 5", knowledge_level=5))
    db.upsert_prep_topic(PrepTopic(student_id=student_id, title="Задание 1", knowledge_level=8))
    db.upsert_prep_topic(PrepTopic(student_id=student_id, title="Задание 3", knowledge_level=4))
    db.close()
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    response = client.get("/api/me", headers=headers)

    assert response.status_code == 200
    topics = response.json()["dashboard"]["topics"]
    assert [topic["task_number"] for topic in topics] == [1, 3, 5]


def test_student_can_create_stable_schedule_with_different_times(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}
    starts_at = date.today() + timedelta(days=1)
    ends_at = starts_at + timedelta(days=7)

    response = client.post(
        "/api/schedule-rules",
        headers=headers,
        json={
            "student_id": student_id,
            "slots": [
                {"weekday": 2, "lesson_time": "18:00"},
                {"weekday": 6, "lesson_time": "11:00"},
            ],
            "duration_minutes": 60,
            "starts_at": starts_at.isoformat(),
            "ends_at": ends_at.isoformat(),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["rules"]) == 2
    created_times = {item["starts_at"][11:16] for item in body["created"]}
    assert created_times <= {"18:00", "11:00"}
    assert created_times


def test_admin_can_delete_student_from_webapp(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    client = TestClient(create_app(settings))
    admin_headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}
    student_headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    forbidden = client.delete(f"/api/admin/students/{student_id}", headers=student_headers)
    assert forbidden.status_code == 403

    response = client.delete(f"/api/admin/students/{student_id}", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["deleted"] is True

    dashboard = client.get("/api/me", headers=admin_headers)
    assert dashboard.status_code == 200
    assert dashboard.json()["admin"]["students"] == []


def test_unlinked_user_gets_registration_payload(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    seed_student(settings)
    client = TestClient(create_app(settings))

    response = client.get(
        "/api/me",
        headers={"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 404)},
    )

    assert response.status_code == 200
    assert response.json()["role"] == "guest"
    assert response.json()["registration"]["timezone_options"][2]["value"] == "МСК+0"


def test_student_can_register_from_webapp_without_typing_telegram_id(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 505, username="max")}

    response = client.post(
        "/api/register",
        headers=headers,
        json={
            "role": "student",
            "full_name": "Майоров Максим Алексеевич",
            "grade": "9",
            "timezone": "МСК+3",
            "prep_type": "ОГЭ",
            "subject": "Информатика",
            "goal": "5",
            "parent_can_edit": True,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "student"
    assert body["dashboard"]["student"]["student_telegram"] == "@max"
    assert body["dashboard"]["student"]["timezoneLabel"] == "МСК+3"
    assert body["dashboard"]["student"]["progress_goal"] == 16


def test_progress_goal_changes_with_selected_exam(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 900)}

    cases = [
        ("ЕГЭ", "Информатика", 27),
        ("ОГЭ", "Информатика", 16),
        ("ЕГЭ", "Математика", 19),
        ("ОГЭ", "Математика", 19),
        ("Python", "", 0),
    ]
    for prep_type, subject, expected_goal in cases:
        response = client.patch(
            f"/api/admin/students/{student_id}",
            headers=headers,
            json={"prep_type": prep_type, "subject": subject},
        )

        assert response.status_code == 200
        assert response.json()["student"]["progress_goal"] == expected_goal
        assert response.json()["student"]["defaultProgressGoal"] == expected_goal


def test_exam_progress_rejects_task_outside_selected_exam(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 101)}

    response = client.patch(
        f"/api/students/{student_id}/progress",
        headers=headers,
        json={"task_number": 28, "knowledge_level": 8},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Для выбранного экзамена доступны задания с 1 по 27"


def test_parent_can_register_from_webapp_by_child_telegram(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    seed_student(settings)
    client = TestClient(create_app(settings))
    headers = {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, 606, username="parent")}

    response = client.post(
        "/api/register",
        headers=headers,
        json={
            "role": "parent",
            "full_name": "Родитель Смирнова",
            "child_telegram": "@anya",
            "timezone": "МСК+0",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "parent"
    assert body["dashboard"]["student"]["parent_telegram"] == "@parent"
