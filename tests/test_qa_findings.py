"""Падающие тесты для находок QA-аудита бизнес-логики (SESSION_ID G0BOT-QA-001).

Каждый тест описывает ОЖИДАЕМОЕ поведение. Тест падает — значит находка
воспроизводится на текущем коде. Подробности и приоритеты — в AUDIT_QA.md.

Ничего в src/ этими тестами не чинится: файл только фиксирует дефекты.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from datetime import date, datetime, time, timedelta
from pathlib import Path
from urllib.parse import urlencode

import pytest
from fastapi.testclient import TestClient

from tutor_bot import main as bot_main
from tutor_bot.config import Settings
from tutor_bot.domain.enums import (
    BalanceMode,
    HomeworkStatus,
    LessonPaymentStatus,
    LessonStatus,
    PaymentStatus,
    PrepTopicStatus,
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
from tutor_bot.services.homework import submit_homework
from tutor_bot.services.payments import confirm_payment
from tutor_bot.services.preparation import knowledge_status, summarize_preparation
from tutor_bot.services.scheduling import WorkHours, cancel_lesson
from tutor_bot.storage.sqlite import SQLiteStorage
from tutor_bot.webapp import (
    create_app,
    default_progress_goal,
    refresh_student_progress_from_topics,
    sync_student_advances,
)

# --------------------------------------------------------------------------- #
# Общая обвязка
# --------------------------------------------------------------------------- #


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
        working_days=[1, 2, 3, 4, 5, 6, 7],
        working_start=time(10, 0),
        working_end=time(22, 0),
        slot_step_minutes=30,
        webapp_url="http://127.0.0.1:8000",
    )


def signed_init_data(bot_token: str, user_id: int, username: str = "") -> str:
    user: dict[str, object] = {"id": user_id, "first_name": "Test"}
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


def seed_student(
    settings: Settings,
    *,
    student_telegram: str = "@anya",
    balance_mode: str = BalanceMode.LESSONS.value,
    price_60: int = 2000,
    prep_type: str = "ЕГЭ",
    subject: str = "Информатика",
) -> int:
    db = SQLiteStorage(settings.database_path)
    student = db.add_student(
        StudentProfile(
            full_name="Аня Смирнова",
            grade="11",
            prep_type=prep_type,
            subject=subject,
            lesson_price=price_60,
            price_60=price_60,
            price_90=round(price_60 * 1.5),
            price_120=price_60 * 2,
            lesson_duration_minutes=60,
            student_telegram=student_telegram,
            timezone="Europe/Moscow",
            start_date=date(2026, 6, 1),
            status=StudentStatus.ACTIVE.value,
            balance_mode=balance_mode,
        )
    )
    db.close()
    return int(student.id)


def bind_account(settings: Settings, telegram_id: int, student_id: int, role: str) -> None:
    db = SQLiteStorage(settings.database_path)
    db.upsert_user(
        UserAccount(telegram_id=telegram_id, role=role, student_id=student_id, full_name="Тест")
    )
    db.close()


def auth(settings: Settings, telegram_id: int, username: str = "") -> dict[str, str]:
    return {"X-Telegram-Init-Data": signed_init_data(settings.bot_token, telegram_id, username)}


# --------------------------------------------------------------------------- #
# Домен 5. Права доступа
# --------------------------------------------------------------------------- #


@pytest.mark.xfail(strict=True, reason="F-01, см. AUDIT_QA.md")
def test_f01_registration_as_parent_must_not_hijack_existing_student(tmp_path: Path) -> None:
    """F-27 (P0). Любой гость, знающий @username ученика, регистрируется
    «родителем» и получает полный доступ к чужой карточке, оплатам и ДЗ."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings, student_telegram="@anya")
    client = TestClient(create_app(settings))

    response = client.post(
        "/api/register",
        json={"role": "parent", "full_name": "Чужой человек", "child_telegram": "@anya"},
        headers=auth(settings, 777, username="stranger"),
    )

    assert response.status_code == 200
    account = response.json()["account"]
    assert account["student_id"] != student_id, (
        "самопровозглашённый родитель привязался к чужому ученику без подтверждения репетитора"
    )


@pytest.mark.xfail(strict=True, reason="F-02, см. AUDIT_QA.md")
def test_f02_parent_must_not_delete_student_profile(tmp_path: Path) -> None:
    """F-28 (P0). DELETE /api/me/student не проверяет роль и parent_can_edit:
    родитель безвозвратно сносит карточку вместе с занятиями, оплатами и ДЗ."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    bind_account(settings, 555, student_id, Role.PARENT.value)
    client = TestClient(create_app(settings))

    response = client.delete("/api/me/student", headers=auth(settings, 555))

    db = SQLiteStorage(settings.database_path)
    survived = db.get_student(student_id)
    db.close()
    assert response.status_code == 403 or survived is not None, (
        "родитель удалил карточку ученика целиком (каскадом ушли занятия, оплаты и ДЗ)"
    )


@pytest.mark.xfail(strict=True, reason="F-03, см. AUDIT_QA.md")
def test_f03_parent_must_not_change_student_timezone(tmp_path: Path) -> None:
    """F-32 (P1). PATCH /api/me/student родителю без parent_can_edit запрещён,
    а PATCH /api/me/timezone — нет. Родитель сдвигает время всех занятий."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    bind_account(settings, 556, student_id, Role.PARENT.value)
    client = TestClient(create_app(settings))

    response = client.patch(
        "/api/me/timezone",
        json={"timezone": "Asia/Vladivostok"},
        headers=auth(settings, 556),
    )

    db = SQLiteStorage(settings.database_path)
    timezone = db.get_student(student_id).timezone
    db.close()
    assert response.status_code == 403 or timezone == "Europe/Moscow", (
        "родитель без parent_can_edit сменил часовой пояс ученика"
    )


@pytest.mark.xfail(strict=True, reason="F-04, см. AUDIT_QA.md")
def test_f04_browser_invite_link_must_be_single_use(tmp_path: Path) -> None:
    """F-26 (P1). mark_browser_invite_used() существует, но не вызывается:
    ссылка входа работает многократно все 10 лет её жизни."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    client = TestClient(create_app(settings))

    created = client.post(
        f"/api/admin/students/{student_id}/browser-invites",
        json={"role": "student"},
        headers=auth(settings, 900),
    )
    assert created.status_code == 200
    token = created.json()["url"].rsplit("/", 1)[-1]

    first = client.get(f"/login/{token}", follow_redirects=False)
    assert first.status_code == 303
    second = client.get(f"/login/{token}", follow_redirects=False)

    assert second.status_code == 404, "инвайт-ссылка переиспользуется и выдаёт новую сессию"


@pytest.mark.xfail(strict=True, reason="F-21, см. AUDIT_QA.md")
def test_f21_dev_auth_must_not_be_reachable_via_host_header(tmp_path: Path) -> None:
    """F-07 (P0, спорно). allow_local_dev_auth() судит по request.url.hostname,
    который берётся из заголовка Host. Клиент подставляет Host: localhost и
    заголовок X-Dev-Telegram-Id с id репетитора — и получает полный админ.
    Реальная эксплуатируемость зависит от того, пробрасывает ли прокси Amvera
    клиентский Host; на голом uvicorn — пробрасывает."""
    settings = make_settings(tmp_path)
    client = TestClient(create_app(settings), base_url="https://tutor.example.com")

    response = client.get(
        "/api/me", headers={"Host": "localhost", "X-Dev-Telegram-Id": "900"}
    )

    assert response.status_code == 401, (
        "подделка заголовка Host выдала роль репетитора без Telegram initData"
    )


# --------------------------------------------------------------------------- #
# Домен 1. Расписание
# --------------------------------------------------------------------------- #


@pytest.mark.xfail(strict=True, reason="F-22, см. AUDIT_QA.md")
def test_f22_past_lesson_must_not_be_cancellable(tmp_path: Path) -> None:
    """F-02 (P1). cancel_lesson смотрит только на флаг charged. Занятие,
    которое уже прошло, но не успело автопровестись (бот лежал), ученик
    отменяет задним числом — и оно исчезает из выручки навсегда.
    Отмена без штрафа заявлена в README, отмена ПОСЛЕ занятия — нет."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    bind_account(settings, 101, student_id, Role.STUDENT.value)
    db = SQLiteStorage(settings.database_path)
    lesson = db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=settings.local_now() - timedelta(days=1),
            duration_minutes=60,
        )
    )
    db.close()

    client = TestClient(create_app(settings))
    response = client.post(f"/api/lessons/{lesson.id}/cancel", headers=auth(settings, 101))

    assert response.status_code == 400, (
        "ученик отменил вчерашнее занятие задним числом и списал его из выручки"
    )


@pytest.mark.xfail(strict=True, reason="F-05, см. AUDIT_QA.md")
def test_f05_cancelling_an_already_cancelled_lesson_must_fail(tmp_path: Path) -> None:
    """F-05 (P2). cancel_lesson не проверяет текущий статус: ученик повторно
    «отменяет» занятие, отменённое преподавателем, и переписывает cancelled_by."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    lesson = db.add_lesson(
        Lesson(student_id=student_id, starts_at=datetime(2026, 9, 1, 18, 0), duration_minutes=60)
    )

    cancel_lesson(db, int(lesson.id), Role.ADMIN.value, "заболел преподаватель")
    raised = False
    try:
        cancel_lesson(db, int(lesson.id), Role.STUDENT.value, "передумал")
    except ValueError:
        raised = True
    stored = db.get_lesson(int(lesson.id))
    db.close()

    assert raised, "повторная отмена прошла молча"
    assert stored.status == LessonStatus.CANCELLED_BY_TEACHER.value
    assert stored.cancellation_reason == "заболел преподаватель"


@pytest.mark.xfail(strict=True, reason="F-06, см. AUDIT_QA.md")
def test_f06_midnight_working_end_must_allow_evening_slots(tmp_path: Path) -> None:
    """F-01 (P2). WORKING_END=00:00 (полночь) делает рабочий день пустым:
    ends_at.time() <= 00:00 не выполняется ни для одного слота."""
    work_hours = WorkHours(weekdays={1, 2, 3, 4, 5, 6, 7}, starts_at=time(10, 0), ends_at=time(0, 0))

    assert work_hours.contains(datetime(2026, 9, 1, 21, 0), 60), (
        "занятие 21:00-22:00 отвергнуто как «вне рабочих часов» при WORKING_END=00:00"
    )


@pytest.mark.xfail(strict=True, reason="F-07, см. AUDIT_QA.md")
def test_f07_reminder_must_not_fire_for_a_lesson_already_in_progress(tmp_path: Path) -> None:
    """F-04 (P2). list_lessons_between отдаёт занятия, ПЕРЕСЕКАЮЩИЕ окно, а не
    начинающиеся в нём. Идущее занятие попадает в выборку напоминания
    «начало через 5 минут»."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    db.add_lesson(
        Lesson(student_id=student_id, starts_at=datetime(2026, 9, 1, 18, 0), duration_minutes=120)
    )

    window_start = datetime(2026, 9, 1, 18, 35)
    window_end = window_start + timedelta(seconds=70)
    found = db.list_lessons_between(window_start, window_end)
    db.close()

    assert found == [], "занятие, идущее прямо сейчас, попало в окно напоминания «скоро занятие»"


# --------------------------------------------------------------------------- #
# Домен 2. Оплаты и баланс
# --------------------------------------------------------------------------- #


@pytest.mark.xfail(strict=True, reason="F-08, см. AUDIT_QA.md")
def test_f08_autocomplete_must_charge_lessons_older_than_12_hours(tmp_path: Path) -> None:
    """F-03 (P1). auto_complete_lessons смотрит только на окно now-12ч..now.
    Простой бота дольше 12 часов = занятия навсегда остаются PLANNED,
    баланс не списывается, счёт ученику не выставляется."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    now = datetime(2026, 9, 2, 12, 0)
    lesson = db.add_lesson(
        Lesson(student_id=student_id, starts_at=now - timedelta(hours=20), duration_minutes=60)
    )

    asyncio.run(bot_main.auto_complete_lessons(None, db, settings, now))
    stored = db.get_lesson(int(lesson.id))
    db.close()

    assert stored.status == LessonStatus.CONDUCTED.value, (
        "занятие 20-часовой давности не проведено и не списано — деньги потеряны"
    )


@pytest.mark.xfail(strict=True, reason="F-09, см. AUDIT_QA.md")
def test_f09_confirm_payment_must_not_credit_nothing(tmp_path: Path) -> None:
    """F-08 (P1). Если у ученика не заполнена цена и в чеке не указано число
    занятий, confirm_payment помечает оплату подтверждённой и начисляет 0."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings, price_60=0)
    db = SQLiteStorage(settings.database_path)
    payment = db.add_payment(
        Payment(student_id=student_id, amount=8000, lessons_count=0, sender_role=Role.STUDENT.value)
    )

    confirm_payment(db, int(payment.id))
    student = db.get_student(student_id)
    db.close()

    assert student.balance_lessons > 0 or student.balance_money > 0, (
        "оплата 8000 ₽ подтверждена, а баланс ученика не изменился"
    )


@pytest.mark.xfail(strict=True, reason="F-10, см. AUDIT_QA.md")
def test_f10_advance_sync_must_not_overwrite_money_balance_mode(tmp_path: Path) -> None:
    """F-13 (P1). sync_student_advances безусловно ставит balance_mode='lessons'
    и перезаписывает balance_lessons. Денежный баланс ученика уничтожается
    при первом же открытии Mini App репетитором."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings, balance_mode=BalanceMode.MONEY.value)
    db = SQLiteStorage(settings.database_path)
    student = db.get_student(student_id)
    student.balance_money = 6000
    db.update_student(student)
    payment = db.add_payment(
        Payment(
            student_id=student_id,
            amount=4000,
            lessons_count=2,
            sender_role=Role.ADMIN.value,
            status=PaymentStatus.CONFIRMED.value,
            confirmed_at=datetime(2026, 8, 1, 12, 0),
        )
    )
    assert payment.id is not None
    db.close()

    app = create_app(settings)
    sync_student_advances(app.state.app_state, student_id)

    db = SQLiteStorage(settings.database_path)
    student = db.get_student(student_id)
    db.close()
    assert student.balance_mode == BalanceMode.MONEY.value, (
        "режим баланса ученика молча переключён на «занятия», 6000 ₽ пропали из интерфейса"
    )


@pytest.mark.xfail(strict=True, reason="F-11, см. AUDIT_QA.md")
def test_f11_income_must_not_be_counted_twice(tmp_path: Path) -> None:
    """F-16 (P1). Проведённое занятие с payment_status=оплачено считается
    доходом, и подтверждённый чек за это же занятие считается доходом ещё раз.
    Месячная выручка удваивается."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings, price_60=2000)
    db = SQLiteStorage(settings.database_path)
    now = settings.local_now().replace(hour=12, minute=0, second=0, microsecond=0)
    lesson = db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=now - timedelta(hours=3),
            duration_minutes=60,
            status=LessonStatus.CONDUCTED.value,
            payment_status=LessonPaymentStatus.CONFIRMED.value,
            payment_marked_by=Role.ADMIN.value,
            payment_confirmed_at=now,
            payment_amount=2000,
        )
    )
    db.add_payment(
        Payment(
            student_id=student_id,
            lesson_id=lesson.id,
            amount=2000,
            lessons_count=0,
            sender_role=Role.STUDENT.value,
            status=PaymentStatus.CONFIRMED.value,
            confirmed_at=now,
        )
    )
    db.close()

    client = TestClient(create_app(settings))
    summary = client.get("/api/me", headers=auth(settings, 900)).json()["admin"]["summary"]

    assert summary["month_income"] == 2000, (
        f"одно занятие за 2000 ₽ дало доход {summary['month_income']} ₽"
    )


@pytest.mark.xfail(strict=True, reason="F-12, см. AUDIT_QA.md")
def test_f12_payment_confirmed_at_must_use_one_timezone_convention(tmp_path: Path) -> None:
    """F-15 (P2). В колонку lessons.payment_confirmed_at бот пишет наивное
    местное время (settings.local_now()), а Mini App — aware UTC (now_utc()).
    Месячная/недельная выручка съезжает на 3 часа на границах периодов."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    bind_account(settings, 101, student_id, Role.STUDENT.value)
    db = SQLiteStorage(settings.database_path)
    now = settings.local_now()
    student = db.get_student(student_id)
    student.balance_lessons = 5  # чтобы бот проставил "оплачено" из предоплаты
    db.update_student(student)
    bot_lesson = db.add_lesson(
        Lesson(student_id=student_id, starts_at=now - timedelta(hours=3), duration_minutes=60)
    )
    app_lesson = db.add_lesson(
        Lesson(student_id=student_id, starts_at=now - timedelta(hours=5), duration_minutes=60)
    )
    db.close()

    client = TestClient(create_app(settings))
    client.post(f"/api/lessons/{app_lesson.id}/mark-paid", json={}, headers=auth(settings, 900))

    db = SQLiteStorage(settings.database_path)
    asyncio.run(bot_main.auto_complete_lessons(None, db, settings, now))
    from_bot = db.get_lesson(int(bot_lesson.id)).payment_confirmed_at
    from_app = db.get_lesson(int(app_lesson.id)).payment_confirmed_at
    db.close()

    assert from_bot is not None and from_app is not None
    assert (from_bot.tzinfo is None) == (from_app.tzinfo is None), (
        f"бот пишет {from_bot!r}, Mini App пишет {from_app!r} — разные часовые конвенции "
        "в одной колонке"
    )


@pytest.mark.xfail(strict=True, reason="F-13, см. AUDIT_QA.md")
def test_f13_free_lesson_must_not_be_marked_paid_by_advance(tmp_path: Path) -> None:
    """F-14 (P2). В advance_ledger занятие считается покрытым при
    covered >= total_cost. Для занятия со стоимостью 0 (цена у ученика не
    заполнена) условие 0 >= 0 истинно — занятие само помечается «оплачено»."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings, price_60=0)
    db = SQLiteStorage(settings.database_path)
    db.add_payment(
        Payment(
            student_id=student_id,
            amount=1000,
            lessons_count=1,
            sender_role=Role.ADMIN.value,
            status=PaymentStatus.CONFIRMED.value,
            confirmed_at=datetime(2026, 8, 1, 10, 0),
        )
    )
    lesson = db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=datetime(2026, 8, 2, 18, 0),
            duration_minutes=60,
            status=LessonStatus.CONDUCTED.value,
            payment_amount=0,
        )
    )
    second = db.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=datetime(2026, 8, 3, 18, 0),
            duration_minutes=60,
            status=LessonStatus.CONDUCTED.value,
            payment_amount=0,
        )
    )
    db.close()

    app = create_app(settings)
    sync_student_advances(app.state.app_state, student_id)

    db = SQLiteStorage(settings.database_path)
    statuses = [
        db.get_lesson(int(lesson.id)).payment_status,
        db.get_lesson(int(second.id)).payment_status,
    ]
    db.close()
    assert statuses.count(LessonPaymentStatus.CONFIRMED.value) <= 1, (
        "аванс на одно занятие закрыл все занятия нулевой стоимости"
    )


# --------------------------------------------------------------------------- #
# Домен 3. Домашние задания
# --------------------------------------------------------------------------- #


@pytest.mark.xfail(strict=True, reason="F-14, см. AUDIT_QA.md")
def test_f14_deadline_must_be_compared_in_teacher_local_time(tmp_path: Path) -> None:
    """F-17 (P1). Дедлайн хранится наивным местным временем (МСК), а
    submit_homework трактует его как UTC. Сдача в течение 3 часов после
    дедлайна засчитывается как своевременная."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    deadline = settings.local_now() - timedelta(hours=1)
    homework = db.add_homework(
        Homework(student_id=student_id, text="Задачи 1-5", deadline=deadline)
    )

    submit_homework(db, int(homework.id), student_id, "готово")
    stored = db.get_homework(int(homework.id))
    db.close()

    assert stored.status == HomeworkStatus.SUBMITTED_LATE.value, (
        "ДЗ сдано через час ПОСЛЕ дедлайна, но помечено как сданное вовремя"
    )


@pytest.mark.xfail(strict=True, reason="F-15, см. AUDIT_QA.md")
def test_f15_resubmission_must_not_erase_teacher_review(tmp_path: Path) -> None:
    """F-18 (P2). submit_homework не смотрит на текущий статус: повторная
    отправка после проверки сбрасывает «проверено» и стирает результат."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    homework = db.add_homework(Homework(student_id=student_id, text="Задачи 1-5"))
    homework.status = HomeworkStatus.CHECKED.value
    homework.teacher_comment = "Отлично, 5"
    db.update_homework(homework)

    submit_homework(db, int(homework.id), student_id, "ещё раз")
    stored = db.get_homework(int(homework.id))
    db.close()

    assert stored.status == HomeworkStatus.CHECKED.value, (
        "повторная сдача откатила проверенное ДЗ обратно в «сдано»"
    )


@pytest.mark.xfail(strict=True, reason="F-16, см. AUDIT_QA.md")
def test_f16_late_homework_must_stay_the_current_one(tmp_path: Path) -> None:
    """F-19 (P2). get_current_homework не знает про статус «сдано с
    опозданием»: после опоздавшей сдачи кнопка «Домашнее задание» в боте
    показывает старое ДЗ или пустоту."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    homework = db.add_homework(
        Homework(
            student_id=student_id,
            text="Задачи 1-5",
            status=HomeworkStatus.SUBMITTED_LATE.value,
        )
    )

    current = db.get_current_homework(student_id)
    db.close()

    assert current is not None and current.id == homework.id, (
        "ДЗ, сданное с опозданием, исчезло из «текущего ДЗ»"
    )


def test_f17_homework_of_deleted_student_must_not_survive(tmp_path: Path) -> None:
    """Не находка (раздел 7 AUDIT_QA.md) — этот тест ПРОХОДИТ. Проверка каскада: сабмиты ДЗ должны уходить вместе с
    учеником. Тест фиксирует фактическое поведение внешних ключей."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings)
    db = SQLiteStorage(settings.database_path)
    homework = db.add_homework(Homework(student_id=student_id, text="Задачи"))
    submit_homework(db, int(homework.id), student_id, "решение")
    db.delete_student(student_id)
    left = db.conn.execute(
        "SELECT COUNT(*) AS n FROM homework_submissions WHERE student_id = ?", (student_id,)
    ).fetchone()["n"]
    db.close()

    assert left == 0, "сабмиты ДЗ пережили удаление ученика"


# --------------------------------------------------------------------------- #
# Домен 4. Подготовка ОГЭ/ЕГЭ
# --------------------------------------------------------------------------- #


@pytest.mark.xfail(strict=True, reason="F-18, см. AUDIT_QA.md")
def test_f18_custom_topic_must_not_inflate_exam_progress(tmp_path: Path) -> None:
    """F-22 (P2). topic_number() склеивает ВСЕ цифры заголовка, поэтому любая
    авторская тема с цифрой («Тема 5 про массивы») считается экзаменационным
    заданием и накручивает прогресс — вплоть до 28/27."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings, prep_type="ЕГЭ", subject="Информатика")
    db = SQLiteStorage(settings.database_path)
    for title in ("Задание 1", "Задание 2", "Задание 3"):
        db.upsert_prep_topic(PrepTopic(student_id=student_id, title=title, knowledge_level=9))
    db.upsert_prep_topic(
        PrepTopic(student_id=student_id, title="Тема 5 про массивы", knowledge_level=9)
    )
    student = db.get_student(student_id)
    db.close()

    app = create_app(settings)
    refresh_student_progress_from_topics(app.state.app_state, student)

    assert default_progress_goal("ЕГЭ", "Информатика") == 27
    assert student.progress_current == 3, (
        f"авторская тема засчитана как экзаменационное задание: {student.progress_current}/27"
    )


@pytest.mark.xfail(strict=True, reason="F-19, см. AUDIT_QA.md")
def test_f19_knowledge_level_thresholds_must_agree(tmp_path: Path) -> None:
    """F-23 (P2). Уровень 7 из 10 в боте — «нужно повторить» (не пройдено), а в
    Mini App прогресс считает знанием >= 7. Один и тот же ученик видит разные
    цифры в двух интерфейсах."""
    topic = PrepTopic(student_id=1, title="Задание 4", knowledge_level=7)
    topic.status = knowledge_status(topic.knowledge_level)

    summary = summarize_preparation([topic], [])
    counted_by_miniapp = 1 if topic.knowledge_level >= 7 else 0

    assert summary.topics_done == counted_by_miniapp, (
        f"бот считает пройденными {summary.topics_done} тем (статус «{topic.status}»), "
        f"Mini App — {counted_by_miniapp}"
    )
    assert topic.status != PrepTopicStatus.REVIEW.value or counted_by_miniapp == 0


@pytest.mark.xfail(strict=True, reason="F-20, см. AUDIT_QA.md")
def test_f20_progress_goal_must_not_ratchet_up_forever(tmp_path: Path) -> None:
    """F-24 (P3). Для ученика без экзамена progress_goal берётся как max(...)
    и никогда не уменьшается: опечатка «задание 100» навсегда ломает шкалу."""
    settings = make_settings(tmp_path)
    student_id = seed_student(settings, prep_type="школьная успеваемость", subject="Алгебра")
    bind_account(settings, 101, student_id, Role.STUDENT.value)
    client = TestClient(create_app(settings))

    client.patch(
        f"/api/students/{student_id}/progress",
        json={"task_number": 100, "knowledge_level": 5},
        headers=auth(settings, 900),
    )
    response = client.patch(
        f"/api/students/{student_id}/progress",
        json={"task_number": 3, "knowledge_level": 5},
        headers=auth(settings, 900),
    )

    goal = response.json()["student"]["progress_goal"]
    assert goal <= 3, f"шкала прогресса застряла на {goal} после опечатки и не откатывается"
