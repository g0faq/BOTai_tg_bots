from __future__ import annotations

import hashlib
import hmac
import json
import logging
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from tutor_bot.bot.formatters import lesson_price_for_duration, ru_dt_text
from tutor_bot.config import Settings, load_dotenv, load_settings
from tutor_bot.domain.enums import (
    HomeworkStatus,
    LessonPaymentStatus,
    LessonStatus,
    PaymentStatus,
    PlanItemStatus,
    Role,
    StudentStatus,
)
from tutor_bot.domain.models import (
    ClosedSlot,
    Homework,
    Lesson,
    Payment,
    PlanItem,
    PrepTopic,
    ScheduleRule,
    StudentProfile,
    UserAccount,
)
from tutor_bot.main import build_work_hours
from tutor_bot.services.homework import submit_homework
from tutor_bot.services.payments import confirm_payment, reject_payment
from tutor_bot.services.preparation import knowledge_status
from tutor_bot.services.scheduling import (
    RecurringLessonSlot,
    SlotUnavailableError,
    add_single_lesson,
    available_slots,
    cancel_lesson,
    create_recurring_lessons_for_local_slots,
    create_recurring_lessons_for_slots,
    validate_slot,
)
from tutor_bot.services.timezones import convert_timezone, normalize_timezone, timezone_label
from tutor_bot.storage.sqlite import SQLiteStorage

STATIC_DIR = Path(__file__).resolve().parent / "web" / "static"
ADMIN_ONLY = {Role.ADMIN.value}


class AppState:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.db = SQLiteStorage(settings.database_path)
        self.work_hours = build_work_hours(settings)


class StudentUpdate(BaseModel):
    full_name: str | None = None
    grade: str | None = None
    timezone: str | None = None
    prep_type: str | None = None
    subject: str | None = None
    goal: str | None = None
    current_level: str | None = None
    lesson_price: int | None = Field(default=None, ge=0)
    progress_current: int | None = Field(default=None, ge=0)
    progress_goal: int | None = Field(default=None, ge=0)
    balance_lessons: int | None = Field(default=None, ge=0)
    parent_can_edit: bool | None = None
    student_telegram: str | None = None
    parent_telegram: str | None = None
    parent_name: str | None = None
    board_url: str | None = None
    meeting_url: str | None = None
    comment: str | None = None


class StudentCreate(BaseModel):
    full_name: str = Field(min_length=1)
    grade: str = ""
    timezone: str = "Europe/Moscow"
    prep_type: str = "другое"
    subject: str = ""
    goal: str = ""
    lesson_price: int = Field(default=0, ge=0)
    student_telegram: str = ""
    parent_name: str = ""
    parent_telegram: str = ""
    board_url: str = ""
    meeting_url: str = ""
    comment: str = ""


class LessonWrite(BaseModel):
    student_id: int
    starts_at: datetime
    duration_minutes: int = Field(ge=30, le=240)
    status: str = LessonStatus.PLANNED.value
    payment_status: str = LessonPaymentStatus.NOT_MARKED.value
    notes: str = ""


class LessonUpdate(BaseModel):
    starts_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=30, le=240)
    status: str | None = None
    payment_status: str | None = None
    payment_amount: int | None = Field(default=None, ge=0)
    notes: str | None = None


class LessonMoveRequest(BaseModel):
    starts_at: datetime
    duration_minutes: int = Field(ge=30, le=240)


class TimezoneUpdate(BaseModel):
    timezone: str = Field(min_length=1)


class RegistrationRequest(BaseModel):
    role: str
    full_name: str = ""
    grade: str = ""
    timezone: str = "Europe/Moscow"
    prep_type: str = "другое"
    subject: str = ""
    goal: str = ""
    parent_name: str = ""
    parent_telegram: str = ""
    child_telegram: str = ""
    parent_can_edit: bool = False


class PaymentRequest(BaseModel):
    amount: int = Field(default=0, ge=0)
    lessons_count: int = Field(default=0, ge=0)
    lesson_id: int | None = None
    comment: str = ""


class AdminPaymentWrite(PaymentRequest):
    student_id: int


class MarkLessonPaymentRequest(BaseModel):
    actor: str | None = None


class HomeworkSubmitRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class HomeworkWrite(BaseModel):
    student_id: int
    title: str = ""
    text: str = Field(min_length=1)
    estimated_minutes: int = Field(default=0, ge=0, le=1440)
    attachments: list[str] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)
    deadline: datetime | None = None
    status: str = HomeworkStatus.WAITING.value
    teacher_comment: str = ""


class HomeworkUpdate(BaseModel):
    title: str | None = None
    text: str | None = None
    estimated_minutes: int | None = Field(default=None, ge=0, le=1440)
    attachments: list[str] | None = None
    links: list[str] | None = None
    deadline: datetime | None = None
    status: str | None = None
    teacher_comment: str | None = None


class BookRequest(BaseModel):
    starts_at: datetime
    duration_minutes: int = Field(ge=30, le=240)


class ScheduleSlotWrite(BaseModel):
    weekday: int = Field(ge=1, le=7)
    lesson_time: str = Field(pattern=r"^\d{2}:\d{2}$")


class ScheduleRuleWrite(BaseModel):
    student_id: int | None = None
    weekdays: list[int] = Field(default_factory=list)
    lesson_time: str = Field(default="18:00", pattern=r"^\d{2}:\d{2}$")
    slots: list[ScheduleSlotWrite] = Field(default_factory=list)
    duration_minutes: int = Field(default=60, ge=30, le=240)
    starts_at: date | None = None
    ends_at: date | None = None


class ClosedSlotWrite(BaseModel):
    starts_at: datetime
    ends_at: datetime
    reason: str = ""


class AvailableSlotsRequest(BaseModel):
    duration_minutes: int = Field(default=60, ge=30, le=240)
    days: int = Field(default=14, ge=1, le=31)
    student_id: int | None = None


class ProgressUpdate(BaseModel):
    task_number: int | None = Field(default=None, ge=1, le=100)
    title: str | None = None
    knowledge_level: int | None = Field(default=None, ge=0, le=10)
    comment: str | None = None


class AdminPaymentDecision(BaseModel):
    action: str
    comment: str = ""


class PlanItemWrite(BaseModel):
    title: str = Field(min_length=1)
    deadline: date | None = None
    comment: str = ""


class PlanItemUpdate(BaseModel):
    title: str | None = None
    deadline: date | None = None
    comment: str | None = None
    status: str | None = None


def verify_init_data(init_data: str, bot_token: str) -> dict[str, Any]:
    if not init_data:
        raise HTTPException(status_code=401, detail="Telegram initData is required")
    values = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = values.pop("hash", "")
    if not received_hash:
        raise HTTPException(status_code=401, detail="Telegram initData hash is missing")
    data_check_string = "\n".join(f"{key}={values[key]}" for key in sorted(values))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_hash, received_hash):
        raise HTTPException(status_code=401, detail="Telegram initData is invalid")
    user_raw = values.get("user", "{}")
    try:
        user = json.loads(user_raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=401, detail="Telegram user payload is invalid") from exc
    if not isinstance(user, dict) or not user.get("id"):
        raise HTTPException(status_code=401, detail="Telegram user is missing")
    return user


def allow_local_dev_auth(request: Request) -> bool:
    host = request.url.hostname or ""
    return host in {"127.0.0.1", "localhost", "::1"}


def resolve_account_for_request(
    request: Request,
    state: AppState,
    init_data: str | None,
    dev_user_id: str | None,
) -> UserAccount:
    if init_data:
        user = verify_init_data(init_data, state.settings.bot_token)
        telegram_id = int(user["id"])
        if telegram_id in state.settings.admin_telegram_ids:
            return state.db.upsert_user(
                UserAccount(
                    telegram_id=telegram_id,
                    role=Role.ADMIN.value,
                    username=user.get("username", ""),
                    full_name=" ".join(
                        part for part in [user.get("first_name", ""), user.get("last_name", "")] if part
                    ),
                )
            )
        account = state.db.get_user(telegram_id)
        if account is None:
            username = user.get("username", "")
            full_name = " ".join(
                part for part in [user.get("first_name", ""), user.get("last_name", "")] if part
            )
            if username:
                student = state.db.find_student_by_contact(f"@{username}")
                if student and student.id:
                    return state.db.upsert_user(
                        UserAccount(
                            telegram_id=telegram_id,
                            role=Role.STUDENT.value,
                            student_id=student.id,
                            username=username,
                            full_name=full_name,
                        )
                    )
            return UserAccount(
                telegram_id=telegram_id,
                role="guest",
                username=username,
                full_name=full_name,
            )
        return account

    if dev_user_id and allow_local_dev_auth(request):
        account = state.db.get_user(int(dev_user_id))
        if account:
            return account
        if int(dev_user_id) in state.settings.admin_telegram_ids:
            return state.db.upsert_user(UserAccount(telegram_id=int(dev_user_id), role=Role.ADMIN.value))
        return UserAccount(telegram_id=int(dev_user_id), role="guest")
    raise HTTPException(status_code=401, detail="Открой Mini App из Telegram")


def serialize_dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def serialize_date(value: date | None) -> str | None:
    return value.isoformat() if value else None


def normalize_timezone_or_400(raw: str | None, default: str = "Europe/Moscow") -> str:
    try:
        return normalize_timezone(raw, default)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def now_utc() -> datetime:
    return datetime.now(UTC)


def to_teacher_time(value: datetime, student: StudentProfile, settings: Settings) -> datetime:
    return convert_timezone(value.replace(tzinfo=None), student.timezone, settings.timezone).replace(tzinfo=None)


def to_student_time(value: datetime, student: StudentProfile, settings: Settings) -> datetime:
    return convert_timezone(value.replace(tzinfo=None), settings.timezone, student.timezone).replace(tzinfo=None)


def month_bounds(today: date) -> tuple[datetime, datetime]:
    start = datetime.combine(date(today.year, today.month, 1), time.min)
    if today.month == 12:
        end = datetime.combine(date(today.year + 1, 1, 1), time.min)
    else:
        end = datetime.combine(date(today.year, today.month + 1, 1), time.min)
    return start, end


def default_progress_goal(prep_type: str, subject: str) -> int:
    value = f"{prep_type} {subject}".lower()
    if "огэ" in value and "информ" in value:
        return 16
    if "огэ" in value and "мат" in value:
        return 19
    if "егэ" in value and "информ" in value:
        return 27
    if "егэ" in value and "мат" in value:
        return 19
    return 0


def apply_default_progress_goal(student: StudentProfile, *, force: bool = False) -> None:
    goal = default_progress_goal(student.prep_type, student.subject)
    if force or student.progress_goal <= 0:
        student.progress_goal = goal
    if student.progress_goal > 0 and student.progress_current > student.progress_goal:
        student.progress_current = student.progress_goal


def timezone_options() -> list[dict[str, str]]:
    return [
        {"value": f"МСК{offset:+d}", "label": f"МСК{offset:+d}"}
        for offset in range(-2, 10)
    ]


def is_cancelled(status: str) -> bool:
    return status == "отменено" or status in {
        LessonStatus.CANCELLED_BY_STUDENT.value,
        LessonStatus.CANCELLED_BY_PARENT.value,
        LessonStatus.CANCELLED_BY_TEACHER.value,
    }


def lesson_status_label(status: str) -> str:
    if is_cancelled(status):
        return "отменено"
    return status


def payment_label(value: str) -> str:
    if value in {LessonPaymentStatus.STUDENT_MARKED.value, LessonPaymentStatus.PARENT_MARKED.value}:
        return "ожидает проверки"
    return value or LessonPaymentStatus.NOT_MARKED.value


def homework_status_label(status: str) -> str:
    if status in {HomeworkStatus.DONE.value, HomeworkStatus.SUBMITTED.value, HomeworkStatus.CHECKED.value}:
        return HomeworkStatus.DONE.value
    if status == HomeworkStatus.CANCELLED.value:
        return HomeworkStatus.CANCELLED.value
    return HomeworkStatus.WAITING.value


def serialize_student(student: StudentProfile) -> dict[str, Any]:
    data = asdict(student)
    exam_goal = default_progress_goal(student.prep_type, student.subject)
    data["name"] = student.full_name
    data["timezoneLabel"] = timezone_label(student.timezone)
    data["defaultProgressGoal"] = exam_goal
    data["hourlyRate"] = student.price_60 or student.lesson_price
    data["preparationType"] = student.prep_type
    data["contacts"] = student.student_telegram
    data["parentContacts"] = " ".join(part for part in [student.parent_name, student.parent_telegram] if part)
    data["parentCanEdit"] = student.parent_can_edit
    data["links"] = {"board": student.board_url, "meeting": student.meeting_url}
    data["notes"] = student.comment
    data["start_date"] = serialize_date(student.start_date)
    data["exam_date"] = serialize_date(student.exam_date)
    data["created_at"] = serialize_dt(student.created_at)
    return data


def serialize_lesson(
    lesson: Lesson,
    student: StudentProfile | None = None,
    teacher_timezone: str = "Europe/Moscow",
) -> dict[str, Any]:
    price = lesson.payment_amount
    if student and price <= 0:
        price = lesson_price_for_duration(student, lesson.duration_minutes)
    student_starts_at = (
        convert_timezone(lesson.starts_at, teacher_timezone, student.timezone).replace(tzinfo=None)
        if student
        else lesson.starts_at
    )
    student_ends_at = (
        convert_timezone(lesson.ends_at, teacher_timezone, student.timezone).replace(tzinfo=None)
        if student
        else lesson.ends_at
    )
    return {
        "id": lesson.id,
        "student_id": lesson.student_id,
        "student_name": student.full_name if student else "",
        "starts_at": serialize_dt(lesson.starts_at),
        "ends_at": serialize_dt(lesson.ends_at),
        "teacher_starts_at": serialize_dt(lesson.starts_at),
        "teacher_ends_at": serialize_dt(lesson.ends_at),
        "student_starts_at": serialize_dt(student_starts_at),
        "student_ends_at": serialize_dt(student_ends_at),
        "duration_minutes": lesson.duration_minutes,
        "status": lesson_status_label(lesson.status),
        "payment_status": lesson.payment_status,
        "payment_label": payment_label(lesson.payment_status),
        "payment_marked_by": lesson.payment_marked_by,
        "payment_confirmed_at": serialize_dt(lesson.payment_confirmed_at),
        "price": price,
        "topic": lesson.topic,
        "next_plan": lesson.next_plan,
        "notes": lesson.notes,
        "recurrenceId": lesson.stable_series_id,
    }


def serialize_slot(
    value: datetime,
    duration_minutes: int,
    student: StudentProfile | None = None,
    teacher_timezone: str = "Europe/Moscow",
) -> dict[str, Any]:
    student_value = (
        convert_timezone(value, teacher_timezone, student.timezone).replace(tzinfo=None)
        if student
        else value
    )
    return {
        "starts_at": serialize_dt(value),
        "ends_at": serialize_dt(value + timedelta(minutes=duration_minutes)),
        "teacher_starts_at": serialize_dt(value),
        "teacher_ends_at": serialize_dt(value + timedelta(minutes=duration_minutes)),
        "student_starts_at": serialize_dt(student_value),
        "student_ends_at": serialize_dt(student_value + timedelta(minutes=duration_minutes)),
        "duration_minutes": duration_minutes,
    }


def serialize_homework(homework: Homework | None, student: StudentProfile | None = None) -> dict[str, Any] | None:
    if homework is None:
        return None
    return {
        "id": homework.id,
        "student_id": homework.student_id,
        "student_name": student.full_name if student else "",
        "title": homework.title or (homework.text[:44] + ("..." if len(homework.text) > 44 else "")),
        "text": homework.text,
        "description": homework.text,
        "estimated_minutes": homework.estimated_minutes,
        "links": homework.links,
        "attachments": homework.materials,
        "deadline": serialize_dt(homework.deadline),
        "status": homework_status_label(homework.status),
        "teacher_comment": homework.teacher_comment,
        "created_at": serialize_dt(homework.created_at),
        "updated_at": serialize_dt(homework.updated_at),
    }


def serialize_payment(payment: Payment, student: StudentProfile | None = None) -> dict[str, Any]:
    return {
        "id": payment.id,
        "lesson_id": payment.lesson_id,
        "student_id": payment.student_id,
        "student_name": student.full_name if student else "",
        "amount": payment.amount,
        "lessons_count": payment.lessons_count,
        "status": payment.status,
        "comment": payment.comment,
        "markedBy": payment.sender_role,
        "created_at": serialize_dt(payment.created_at),
        "confirmed_at": serialize_dt(payment.confirmed_at),
    }


def serialize_closed_slot(slot: ClosedSlot) -> dict[str, Any]:
    return {
        "id": slot.id,
        "starts_at": serialize_dt(slot.starts_at),
        "ends_at": serialize_dt(slot.ends_at),
        "reason": slot.reason,
        "created_at": serialize_dt(slot.created_at),
    }


def serialize_topic(topic: PrepTopic) -> dict[str, Any]:
    data = asdict(topic)
    data["task_number"] = topic_number(topic.title)
    return data


def serialize_topics(topics: list[PrepTopic]) -> list[dict[str, Any]]:
    return sorted(
        [serialize_topic(topic) for topic in topics],
        key=lambda item: item["task_number"] or 10_000,
    )


def serialize_plan_item(item: PlanItem) -> dict[str, Any]:
    data = asdict(item)
    data["deadline"] = serialize_date(item.deadline)
    return data


def topic_number(title: str) -> int | None:
    digits = "".join(ch for ch in title if ch.isdigit())
    return int(digits) if digits else None


def serialize_account(account: UserAccount) -> dict[str, Any]:
    return {
        "telegram_id": account.telegram_id,
        "role": account.role,
        "student_id": account.student_id,
        "username": account.username,
        "full_name": account.full_name,
        "created_at": serialize_dt(account.created_at),
    }


def student_bundle(state: AppState, student_id: int) -> dict[str, Any]:
    student = state.db.get_student(student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Ученик не найден")
    lessons = state.db.list_student_lessons(student.id, limit=120)
    lessons_sorted = sorted(lessons, key=lambda item: item.starts_at)
    today = state.settings.local_today()
    current_start = datetime.combine(today, time.min)
    current_end = datetime.combine(today + timedelta(days=14), time.max)
    archive_start = datetime.combine(today - timedelta(days=14), time.min)
    archive_end = datetime.combine(today - timedelta(days=1), time.max)
    current_lessons = [
        lesson for lesson in lessons_sorted if current_start <= lesson.starts_at <= current_end and not is_cancelled(lesson.status)
    ]
    archive_lessons = [
        lesson for lesson in lessons_sorted if archive_start <= lesson.starts_at <= archive_end and not is_cancelled(lesson.status)
    ]
    homeworks = state.db.list_homeworks(student.id, limit=60)
    payments = state.db.list_student_payments(student.id)[:30]
    topics = state.db.list_prep_topics(student.id)
    rules = state.db.list_schedule_rules(student.id)
    now = state.settings.local_now()
    next_lesson = next(
        (
            lesson
            for lesson in lessons_sorted
            if lesson.status == LessonStatus.PLANNED.value and lesson.starts_at >= now
        ),
        None,
    )
    return {
        "student": serialize_student(student),
        "summary": {
            "next_lesson": serialize_lesson(next_lesson, student, state.settings.timezone) if next_lesson else None,
            "open_homework": len(
                [item for item in homeworks if item.status in {HomeworkStatus.ASSIGNED.value, HomeworkStatus.WAITING.value}]
            ),
            "unpaid_lessons": len(
                [
                    lesson
                    for lesson in lessons
                    if lesson.status == LessonStatus.CONDUCTED.value
                    and lesson.payment_status
                    in {LessonPaymentStatus.NOT_MARKED.value, LessonPaymentStatus.UNPAID.value}
                ]
            ),
            "progress_percent": (
                round(student.progress_current / student.progress_goal * 100)
                if student.progress_goal > 0
                else None
            ),
        },
        "lessons": [serialize_lesson(lesson, student, state.settings.timezone) for lesson in current_lessons],
        "lesson_archive": [serialize_lesson(lesson, student, state.settings.timezone) for lesson in archive_lessons],
        "homeworks": [serialize_homework(homework, student) for homework in homeworks],
        "payments": [serialize_payment(payment, student) for payment in payments],
        "topics": serialize_topics(topics),
        "plan": [serialize_plan_item(item) for item in state.db.list_plan_items(student.id)],
        "schedule_rules": [asdict(rule) for rule in rules],
    }


def admin_bundle(state: AppState) -> dict[str, Any]:
    today = state.settings.local_today()
    now = state.settings.local_now()
    week_start = datetime.combine(today - timedelta(days=today.weekday()), time.min)
    week_end = week_start + timedelta(days=7)
    today_start = datetime.combine(today, time.min)
    today_end = datetime.combine(today, time.max)
    month_start, month_end = month_bounds(today)
    calendar_start = datetime.combine(today, time.min)
    calendar_end = datetime.combine(today + timedelta(days=14), time.max)
    archive_start = datetime.combine(today - timedelta(days=14), time.min)
    archive_end = datetime.combine(today - timedelta(days=1), time.max)
    students = state.db.list_students()
    calendar_lessons = state.db.list_lessons_between(calendar_start, calendar_end, include_cancelled=False)
    archive_lessons = state.db.list_lessons_between(archive_start, archive_end, include_cancelled=False)
    closed_slots = state.db.list_closed_slots_between(calendar_start, calendar_end)
    closed_slots_archive = state.db.list_closed_slots_between(archive_start, archive_end)
    month_lessons = state.db.list_lessons_between(month_start, month_end, include_cancelled=False)
    week_lessons = state.db.list_lessons_between(week_start, week_end, include_cancelled=False)
    today_lessons = state.db.list_lessons_between(today_start, today_end, include_cancelled=False)
    homeworks = state.db.list_homeworks(limit=120)
    payments = state.db.list_pending_payments()
    confirmed_month_payments = [
        payment
        for student in students
        for payment in state.db.list_student_payments(student.id)
        if payment.status == PaymentStatus.CONFIRMED.value
        and payment.confirmed_at
        and month_start <= payment.confirmed_at.replace(tzinfo=None) < month_end
    ]
    confirmed_week_payments = [
        payment
        for student in students
        for payment in state.db.list_student_payments(student.id)
        if payment.status == PaymentStatus.CONFIRMED.value
        and payment.confirmed_at
        and week_start <= payment.confirmed_at.replace(tzinfo=None) < week_end
    ]
    confirmed_today_payments = [
        payment
        for student in students
        for payment in state.db.list_student_payments(student.id)
        if payment.status == PaymentStatus.CONFIRMED.value
        and payment.confirmed_at
        and today_start <= payment.confirmed_at.replace(tzinfo=None) <= today_end
    ]

    student_by_id = {student.id: student for student in students}
    topics_by_student = {
        student.id: serialize_topics(state.db.list_prep_topics(student.id))
        for student in students
        if student.id is not None
    }
    plan_by_student = {
        student.id: [serialize_plan_item(item) for item in state.db.list_plan_items(student.id)]
        for student in students
        if student.id is not None
    }
    confirmed_lesson_income = sum(
        serialize_lesson(lesson, student_by_id.get(lesson.student_id), state.settings.timezone)["price"]
        for lesson in month_lessons
        if lesson.status == LessonStatus.CONDUCTED.value
        and lesson.payment_status == LessonPaymentStatus.CONFIRMED.value
    )
    month_income = confirmed_lesson_income + sum(payment.amount for payment in confirmed_month_payments)
    week_income = sum(
        serialize_lesson(lesson, student_by_id.get(lesson.student_id), state.settings.timezone)["price"]
        for lesson in week_lessons
        if lesson.status == LessonStatus.CONDUCTED.value
        and lesson.payment_status == LessonPaymentStatus.CONFIRMED.value
    ) + sum(payment.amount for payment in confirmed_week_payments)
    today_income = sum(
        serialize_lesson(lesson, student_by_id.get(lesson.student_id), state.settings.timezone)["price"]
        for lesson in today_lessons
        if lesson.status == LessonStatus.CONDUCTED.value
        and lesson.payment_status == LessonPaymentStatus.CONFIRMED.value
    ) + sum(payment.amount for payment in confirmed_today_payments)
    income_events = [
        {
            "amount": payment.amount,
            "confirmed_at": serialize_dt(payment.confirmed_at),
            "student_name": student_by_id.get(payment.student_id).full_name if student_by_id.get(payment.student_id) else "",
            "source": "payment",
        }
        for student in students
        for payment in state.db.list_student_payments(student.id)
        if payment.status == PaymentStatus.CONFIRMED.value and payment.confirmed_at
    ] + [
        {
            "amount": serialize_lesson(lesson, student_by_id.get(lesson.student_id), state.settings.timezone)["price"],
            "confirmed_at": serialize_dt(lesson.payment_confirmed_at or lesson.starts_at),
            "student_name": student_by_id.get(lesson.student_id).full_name if student_by_id.get(lesson.student_id) else "",
            "source": "lesson",
        }
        for lesson in month_lessons
        if lesson.status == LessonStatus.CONDUCTED.value
        and lesson.payment_status == LessonPaymentStatus.CONFIRMED.value
    ]
    pending_lessons = [
        lesson
        for lesson in calendar_lessons + archive_lessons
        if lesson.status == LessonStatus.PENDING_CONFIRMATION.value
    ]
    pending_lesson_payments = [
        lesson
        for lesson in calendar_lessons
        if lesson.payment_status
        in {LessonPaymentStatus.STUDENT_MARKED.value, LessonPaymentStatus.PARENT_MARKED.value}
    ]
    unpaid_lessons = [
        lesson
        for lesson in calendar_lessons
        if lesson.status == LessonStatus.CONDUCTED.value
        and lesson.payment_status in {LessonPaymentStatus.NOT_MARKED.value, LessonPaymentStatus.UNPAID.value}
    ]
    expected_income = sum(serialize_lesson(lesson, student_by_id.get(lesson.student_id), state.settings.timezone)["price"] for lesson in unpaid_lessons)
    next_lesson = next(
        (
            lesson
            for lesson in sorted(calendar_lessons, key=lambda item: item.starts_at)
            if lesson.status == LessonStatus.PLANNED.value and lesson.starts_at >= now
        ),
        None,
    )
    problem_students = []
    for student in students:
        student_lessons = [lesson for lesson in calendar_lessons if lesson.student_id == student.id]
        student_homeworks = [homework for homework in homeworks if homework.student_id == student.id]
        unpaid = [
            lesson
            for lesson in student_lessons
            if lesson.status == LessonStatus.CONDUCTED.value
            and lesson.payment_status in {LessonPaymentStatus.NOT_MARKED.value, LessonPaymentStatus.UNPAID.value}
        ]
        open_homework = [
            homework
            for homework in student_homeworks
            if homework.status in {HomeworkStatus.ASSIGNED.value, HomeworkStatus.WAITING.value, HomeworkStatus.NEEDS_FIX.value}
        ]
        if unpaid or open_homework:
            problem_students.append(
                {
                    "student": serialize_student(student),
                    "unpaid_count": len(unpaid),
                    "homework_count": len(open_homework),
                }
            )

    return {
        "summary": {
            "students": len(students),
            "pending_payments": len(payments) + len(pending_lesson_payments),
            "pending_lessons": len(pending_lessons),
            "month_income": month_income,
            "week_income": week_income,
            "today_income": today_income,
            "expected_income": expected_income,
            "week_lessons": len([lesson for lesson in week_lessons if not is_cancelled(lesson.status)]),
            "next_lesson": serialize_lesson(next_lesson, student_by_id.get(next_lesson.student_id), state.settings.timezone) if next_lesson else None,
            "problem_students": problem_students[:8],
        },
        "students": [serialize_student(student) for student in students],
        "topics_by_student": topics_by_student,
        "plan_by_student": plan_by_student,
        "calendar": [
            serialize_lesson(lesson, student_by_id.get(lesson.student_id), state.settings.timezone)
            for lesson in sorted(calendar_lessons, key=lambda item: item.starts_at)
        ],
        "calendar_archive": [
            serialize_lesson(lesson, student_by_id.get(lesson.student_id), state.settings.timezone)
            for lesson in sorted(archive_lessons, key=lambda item: item.starts_at)
        ],
        "closed_slots": [serialize_closed_slot(slot) for slot in closed_slots],
        "closed_slots_archive": [serialize_closed_slot(slot) for slot in closed_slots_archive],
        "pending_lessons": [
            serialize_lesson(lesson, student_by_id.get(lesson.student_id), state.settings.timezone)
            for lesson in sorted(pending_lessons, key=lambda item: item.starts_at)
        ],
        "homeworks": [
            serialize_homework(homework, student_by_id.get(homework.student_id))
            for homework in homeworks
        ],
        "finances": {
            "month_income": month_income,
            "week_income": week_income,
            "today_income": today_income,
            "expected_income": expected_income,
            "pending": [serialize_payment(payment, student_by_id.get(payment.student_id)) for payment in payments]
            + [serialize_lesson(lesson, student_by_id.get(lesson.student_id), state.settings.timezone) for lesson in pending_lesson_payments],
            "unpaid_lessons": [serialize_lesson(lesson, student_by_id.get(lesson.student_id), state.settings.timezone) for lesson in unpaid_lessons],
            "payments": [
                serialize_payment(payment, student_by_id.get(payment.student_id))
                for student in students
                for payment in state.db.list_student_payments(student.id)[:10]
            ],
            "income_events": income_events,
        },
    }


def require_admin(account: UserAccount) -> None:
    if account.role not in ADMIN_ONLY:
        raise HTTPException(status_code=403, detail="Нужен доступ репетитора")


def can_access_student(account: UserAccount, student_id: int) -> bool:
    return account.role == Role.ADMIN.value or account.student_id == student_id


def can_manage_student_calendar(state: AppState, account: UserAccount, student_id: int) -> bool:
    if account.role in {Role.ADMIN.value, Role.STUDENT.value}:
        return can_access_student(account, student_id)
    if account.role == Role.PARENT.value and account.student_id == student_id:
        student = state.db.get_student(student_id)
        return bool(student and student.parent_can_edit)
    return False


def lesson_request_reply_markup(lesson_id: int | None) -> dict[str, Any] | None:
    if lesson_id is None:
        return None
    return {
        "inline_keyboard": [
            [
                {"text": "Подтвердить", "callback_data": f"lesson_request_confirm:{lesson_id}"},
                {"text": "Предложить перенос", "callback_data": f"lesson_request_move:{lesson_id}"},
            ]
        ]
    }


def student_lesson_confirmation_reply_markup(lesson_id: int | None) -> dict[str, Any] | None:
    if lesson_id is None:
        return None
    return {
        "inline_keyboard": [
            [
                {"text": "Подтвердить занятие", "callback_data": f"student_lesson_confirm:{lesson_id}"},
                {"text": "Перенести", "callback_data": f"move_lesson:{lesson_id}"},
            ]
        ]
    }


def student_lesson_time_text(lesson: Lesson, student: StudentProfile | None, settings: Settings) -> str:
    return ru_dt_text(lesson.starts_at, student.timezone if student else settings.timezone, settings.timezone)


def student_lesson_confirmation_text(
    lesson: Lesson,
    settings: Settings,
    student: StudentProfile | None = None,
) -> str:
    return "\n".join(
        [
            "Нужно подтвердить занятие:",
            student_lesson_time_text(lesson, student, settings),
            f"Длительность: {lesson.duration_minutes} мин",
            "Если время не подходит, выбери перенос.",
        ]
    )


def lesson_changed_text(title: str, lesson: Lesson, settings: Settings) -> str:
    return "\n".join(
        [
            title,
            ru_dt_text(lesson.starts_at, settings.timezone, settings.timezone),
            f"Статус: {lesson_status_label(lesson.status)}",
            f"Длительность: {lesson.duration_minutes} мин",
        ]
    )


def notify_admins_sync(settings: Settings, text: str, reply_markup: dict[str, Any] | None = None) -> None:
    if not settings.bot_token:
        return
    for admin_id in settings.admin_telegram_ids:
        try:
            payload: dict[str, Any] = {"chat_id": admin_id, "text": text}
            if reply_markup:
                payload["reply_markup"] = reply_markup
            httpx.post(
                f"https://api.telegram.org/bot{settings.bot_token}/sendMessage",
                json=payload,
                timeout=5,
            )
        except Exception:
            logging.exception("Failed to send admin notification")


def notify_student_users_sync(
    state: AppState,
    student_id: int,
    text: str,
    reply_markup: dict[str, Any] | None = None,
) -> None:
    if not state.settings.bot_token:
        return
    for user in state.db.list_users_by_student(student_id):
        try:
            payload: dict[str, Any] = {"chat_id": user.telegram_id, "text": text}
            if reply_markup:
                payload["reply_markup"] = reply_markup
            httpx.post(
                f"https://api.telegram.org/bot{state.settings.bot_token}/sendMessage",
                json=payload,
                timeout=5,
            )
        except Exception:
            logging.exception("Failed to send student notification")


def collect_available_slots(
    state: AppState,
    duration_minutes: int,
    days: int = 14,
    start_day: date | None = None,
    student: StudentProfile | None = None,
) -> list[dict[str, Any]]:
    first_day = start_day or state.settings.local_today()
    slots: list[dict[str, Any]] = []
    for index in range(days):
        day = first_day + timedelta(days=index)
        for slot in available_slots(state.db, day, duration_minutes, state.work_hours):
            if slot >= state.settings.local_now():
                slots.append(serialize_slot(slot, duration_minutes, student, state.settings.timezone))
    return slots


def slot_unavailable_payload(
    state: AppState,
    exc: SlotUnavailableError,
    starts_at: datetime,
    duration_minutes: int,
    student: StudentProfile | None = None,
) -> dict[str, Any]:
    return {
        "message": "Это время уже занято. Выбери другое свободное окно.",
        "conflicts": [conflict.message for conflict in exc.conflicts],
        "suggested_slots": collect_available_slots(
            state,
            duration_minutes,
            days=14,
            start_day=starts_at.date(),
            student=student,
        )[:18],
    }


def slot_conflicts_payload(
    state: AppState,
    conflicts: list[Any],
    starts_at: datetime,
    duration_minutes: int,
    student: StudentProfile | None = None,
) -> dict[str, Any]:
    return {
        "message": "Это время уже занято. Выбери другое свободное окно.",
        "conflicts": [conflict.message for conflict in conflicts],
        "suggested_slots": collect_available_slots(
            state,
            duration_minutes,
            days=14,
            start_day=starts_at.date(),
            student=student,
        )[:18],
    }


def create_app(settings: Settings | None = None) -> FastAPI:
    if settings is None:
        load_dotenv()
        settings = load_settings()
    state = AppState(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        try:
            yield
        finally:
            state.db.close()

    app = FastAPI(title="Tutor Telegram Mini App", lifespan=lifespan)
    app.state.app_state = state

    @app.middleware("http")
    async def disable_webapp_cache(request: Request, call_next):
        response = await call_next(request)
        if request.url.path == "/" or request.url.path.startswith("/assets/"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

    app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")

    def current_account(
        request: Request,
        x_telegram_init_data: str | None = Header(default=None),
        x_dev_telegram_id: str | None = Header(default=None),
    ) -> UserAccount:
        return resolve_account_for_request(request, state, x_telegram_init_data, x_dev_telegram_id)

    current_account_dep = Depends(current_account)

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(
            STATIC_DIR / "index.html",
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )

    @app.get("/api/me")
    def me(account: UserAccount = current_account_dep) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "account": serialize_account(account),
            "role": "tutor" if account.role == Role.ADMIN.value else account.role,
            "teacher_chat_url": state.settings.teacher_chat_link,
            "server_time": serialize_dt(state.settings.local_now()),
        }
        if account.role == Role.ADMIN.value:
            payload["admin"] = admin_bundle(state)
        elif account.student_id:
            payload["dashboard"] = student_bundle(state, account.student_id)
        else:
            payload["role"] = "guest"
            payload["registration"] = {
                "telegram_name": account.full_name,
                "telegram_username": account.username,
                "timezone_options": timezone_options(),
            }
        return payload

    @app.post("/api/register")
    def register(request_data: RegistrationRequest, account: UserAccount = current_account_dep) -> dict[str, Any]:
        if account.role == Role.ADMIN.value:
            raise HTTPException(status_code=400, detail="Репетитор уже зарегистрирован")
        if request_data.role not in {Role.STUDENT.value, Role.PARENT.value}:
            raise HTTPException(status_code=400, detail="Выбери роль: ученик или родитель")
        timezone = normalize_timezone_or_400(request_data.timezone)
        telegram_contact = f"@{account.username}" if account.username else ""

        if request_data.role == Role.PARENT.value:
            child_contact = request_data.child_telegram.strip()
            if not child_contact:
                raise HTTPException(status_code=400, detail="Укажи Telegram ребенка")
            student = state.db.find_student_by_contact(child_contact)
            if student is None:
                student = state.db.add_student(
                    StudentProfile(
                        full_name=f"Ученик {child_contact}",
                        timezone=timezone,
                        student_telegram=child_contact,
                        parent_name=request_data.full_name.strip() or account.full_name,
                        parent_telegram=telegram_contact,
                        status=StudentStatus.LEAD.value,
                    )
                )
            else:
                student.parent_name = request_data.full_name.strip() or student.parent_name or account.full_name
                student.parent_telegram = telegram_contact or student.parent_telegram
                student.timezone = student.timezone or timezone
                state.db.update_student(student)
            state.db.upsert_user(
                UserAccount(
                    telegram_id=account.telegram_id,
                    role=Role.PARENT.value,
                    student_id=student.id,
                    username=account.username,
                    full_name=request_data.full_name.strip() or account.full_name,
                )
            )
        else:
            full_name = request_data.full_name.strip() or account.full_name
            if not full_name:
                raise HTTPException(status_code=400, detail="Укажи ФИО")
            student = state.db.find_student_by_contact(telegram_contact) if telegram_contact else None
            if student is None:
                student = state.db.add_student(
                    StudentProfile(
                        full_name=full_name,
                        grade=request_data.grade.strip(),
                        timezone=timezone,
                        prep_type=request_data.prep_type,
                        subject=request_data.subject.strip(),
                        goal=request_data.goal.strip(),
                        student_telegram=telegram_contact,
                        parent_name=request_data.parent_name.strip(),
                        parent_telegram=request_data.parent_telegram.strip(),
                        parent_can_edit=request_data.parent_can_edit,
                        status=StudentStatus.LEAD.value,
                    )
                )
            else:
                student.full_name = full_name
                student.grade = request_data.grade.strip() or student.grade
                student.timezone = timezone
                student.prep_type = request_data.prep_type or student.prep_type
                student.subject = request_data.subject.strip() or student.subject
                student.goal = request_data.goal.strip() or student.goal
                student.parent_name = request_data.parent_name.strip() or student.parent_name
                student.parent_telegram = request_data.parent_telegram.strip() or student.parent_telegram
                student.parent_can_edit = request_data.parent_can_edit
            apply_default_progress_goal(student)
            state.db.update_student(student)
            state.db.upsert_user(
                UserAccount(
                    telegram_id=account.telegram_id,
                    role=Role.STUDENT.value,
                    student_id=student.id,
                    username=account.username,
                    full_name=full_name,
                )
            )

        notify_admins_sync(
            state.settings,
            "\n".join(
                [
                    "Новая регистрация в Mini App",
                    f"Роль: {'родитель' if request_data.role == Role.PARENT.value else 'ученик'}",
                    f"Имя: {request_data.full_name.strip() or account.full_name or 'не указано'}",
                ]
            ),
        )
        registered = state.db.get_user(account.telegram_id)
        if registered is None:
            raise HTTPException(status_code=500, detail="Регистрация не сохранилась")
        return me(registered)

    @app.get("/api/admin/students/{student_id}")
    def get_student_detail(student_id: int, account: UserAccount = current_account_dep) -> dict[str, Any]:
        require_admin(account)
        return student_bundle(state, student_id)

    @app.post("/api/admin/students")
    def create_student(request_data: StudentCreate, account: UserAccount = current_account_dep) -> dict[str, Any]:
        require_admin(account)
        lesson_price = int(request_data.lesson_price)
        contact = request_data.student_telegram.strip()
        student = state.db.find_student_by_contact(contact) if contact else None
        if student is None:
            student = state.db.find_student_by_identity(
                request_data.full_name.strip(),
                request_data.grade.strip(),
                request_data.subject.strip(),
            )
        if student is None:
            student = state.db.add_student(
                StudentProfile(
                    full_name=request_data.full_name.strip(),
                    grade=request_data.grade.strip(),
                    timezone=normalize_timezone_or_400(request_data.timezone),
                    prep_type=request_data.prep_type,
                    subject=request_data.subject.strip(),
                    goal=request_data.goal.strip(),
                    lesson_price=lesson_price,
                    price_60=lesson_price,
                    price_90=round(lesson_price * 1.5),
                    price_120=lesson_price * 2,
                    student_telegram=contact,
                    parent_name=request_data.parent_name.strip(),
                    parent_telegram=request_data.parent_telegram.strip(),
                    board_url=request_data.board_url.strip(),
                    meeting_url=request_data.meeting_url.strip(),
                    comment=request_data.comment.strip(),
                )
            )
        else:
            student.full_name = request_data.full_name.strip() or student.full_name
            student.grade = request_data.grade.strip() or student.grade
            student.timezone = normalize_timezone_or_400(request_data.timezone, student.timezone)
            student.prep_type = request_data.prep_type or student.prep_type
            student.subject = request_data.subject.strip() or student.subject
            student.goal = request_data.goal.strip() or student.goal
            student.lesson_price = lesson_price
            student.price_60 = lesson_price
            student.price_90 = round(lesson_price * 1.5)
            student.price_120 = lesson_price * 2
            student.student_telegram = contact or student.student_telegram
            student.parent_name = request_data.parent_name.strip() or student.parent_name
            student.parent_telegram = request_data.parent_telegram.strip() or student.parent_telegram
            student.board_url = request_data.board_url.strip() or student.board_url
            student.meeting_url = request_data.meeting_url.strip() or student.meeting_url
            student.comment = request_data.comment.strip() or student.comment
        apply_default_progress_goal(student)
        state.db.update_student(student)
        return {"student": serialize_student(student)}

    @app.patch("/api/admin/students/{student_id}")
    def update_student(
        student_id: int,
        request_data: StudentUpdate,
        account: UserAccount = current_account_dep,
    ) -> dict[str, Any]:
        require_admin(account)
        student = state.db.get_student(student_id)
        if student is None:
            raise HTTPException(status_code=404, detail="Ученик не найден")
        data = request_data.model_dump(exclude_unset=True)
        if "timezone" in data and data["timezone"]:
            data["timezone"] = normalize_timezone_or_400(data["timezone"], student.timezone)
        if "lesson_price" in data and data["lesson_price"] is not None:
            value = int(data.pop("lesson_price"))
            student.lesson_price = value
            student.price_60 = value
            student.price_90 = round(value * 1.5)
            student.price_120 = value * 2
        for field, value in data.items():
            if value is not None and hasattr(student, field):
                setattr(student, field, value)
        if "prep_type" in data or "subject" in data:
            apply_default_progress_goal(student, force=True)
        state.db.update_student(student)
        return student_bundle(state, student_id)

    @app.delete("/api/admin/students/{student_id}")
    def delete_student(student_id: int, account: UserAccount = current_account_dep) -> dict[str, Any]:
        require_admin(account)
        student = state.db.get_student(student_id)
        if student is None:
            raise HTTPException(status_code=404, detail="Ученик не найден")
        state.db.delete_student(student_id)
        return {"deleted": True, "student_id": student_id}

    @app.patch("/api/me/student")
    def update_my_student(
        request_data: StudentUpdate,
        account: UserAccount = current_account_dep,
    ) -> dict[str, Any]:
        if not account.student_id:
            raise HTTPException(status_code=403, detail="Аккаунт не привязан к ученику")
        if account.role == Role.PARENT.value:
            student = state.db.get_student(account.student_id)
            if not student or not student.parent_can_edit:
                raise HTTPException(status_code=403, detail="Родитель может смотреть анкету, но не редактировать")
        student = state.db.get_student(account.student_id)
        if student is None:
            raise HTTPException(status_code=404, detail="Ученик не найден")
        allowed_fields = {
            "full_name",
            "grade",
            "timezone",
            "prep_type",
            "subject",
            "goal",
            "current_level",
            "student_telegram",
            "parent_telegram",
            "parent_name",
            "board_url",
            "meeting_url",
            "comment",
        }
        labels = {
            "full_name": "Имя",
            "grade": "Класс",
            "timezone": "Часовой пояс",
            "prep_type": "Подготовка",
            "subject": "Предмет",
            "goal": "Цель",
            "current_level": "Уровень",
            "student_telegram": "Контакт ученика",
            "parent_telegram": "Контакт родителя",
            "parent_name": "Имя родителя",
            "board_url": "Доска",
            "meeting_url": "Звонок",
            "comment": "Комментарий",
        }
        changed: list[str] = []
        data = request_data.model_dump(exclude_unset=True)
        if "timezone" in data and data["timezone"]:
            data["timezone"] = normalize_timezone_or_400(data["timezone"], student.timezone)
        for field, value in data.items():
            if field not in allowed_fields or value is None:
                continue
            old_value = getattr(student, field)
            if old_value != value:
                setattr(student, field, value)
                changed.append(f"{labels.get(field, field)}: {old_value or 'пусто'} -> {value or 'пусто'}")
        if changed:
            if "prep_type" in data or "subject" in data:
                apply_default_progress_goal(student, force=True)
            state.db.update_student(student)
            actor = "родитель" if account.role == Role.PARENT.value else "ученик"
            notify_admins_sync(
                state.settings,
                "\n".join(
                    [
                        "📝 Анкета обновлена",
                        f"Кто: {actor}",
                        f"Ученик: {student.full_name}",
                        "",
                        *changed[:12],
                    ]
                ),
            )
        return student_bundle(state, student.id)

    @app.delete("/api/me/student")
    def delete_my_student(account: UserAccount = current_account_dep) -> dict[str, Any]:
        if not account.student_id:
            raise HTTPException(status_code=403, detail="Аккаунт не привязан к ученику")
        student = state.db.get_student(account.student_id)
        if student is None:
            return {"deleted": True}
        state.db.delete_student(student.id)
        notify_admins_sync(
            state.settings,
            "\n".join(
                [
                    "Ученик удалил профиль в Mini App",
                    f"Ученик: {student.full_name}",
                ]
            ),
        )
        return {"deleted": True}

    @app.post("/api/admin/lessons")
    def create_lesson(request_data: LessonWrite, account: UserAccount = current_account_dep) -> dict[str, Any]:
        require_admin(account)
        student = state.db.get_student(request_data.student_id)
        if student is None:
            raise HTTPException(status_code=404, detail="Ученик не найден")
        starts_at = request_data.starts_at.replace(tzinfo=None)
        conflicts = validate_slot(state.db, starts_at, request_data.duration_minutes, state.work_hours)
        if conflicts:
            raise HTTPException(
                status_code=409,
                detail=slot_conflicts_payload(state, conflicts, starts_at, request_data.duration_minutes),
            )
        lesson = state.db.add_lesson(
            Lesson(
                student_id=request_data.student_id,
                starts_at=starts_at,
                duration_minutes=request_data.duration_minutes,
                status=LessonStatus.PENDING_CONFIRMATION.value,
                payment_status=request_data.payment_status,
                payment_amount=lesson_price_for_duration(student, request_data.duration_minutes),
                notes=request_data.notes,
            )
        )
        notify_student_users_sync(
            state,
            lesson.student_id,
            student_lesson_confirmation_text(lesson, state.settings, student),
            reply_markup=student_lesson_confirmation_reply_markup(lesson.id),
        )
        return {"lesson": serialize_lesson(lesson, student, state.settings.timezone)}

    @app.patch("/api/admin/lessons/{lesson_id}")
    def update_lesson(
        lesson_id: int,
        request_data: LessonUpdate,
        account: UserAccount = current_account_dep,
    ) -> dict[str, Any]:
        require_admin(account)
        lesson = state.db.get_lesson(lesson_id)
        if lesson is None:
            raise HTTPException(status_code=404, detail="Урок не найден")
        old_lesson = Lesson(
            id=lesson.id,
            student_id=lesson.student_id,
            starts_at=lesson.starts_at,
            duration_minutes=lesson.duration_minutes,
            status=lesson.status,
            payment_status=lesson.payment_status,
            payment_amount=lesson.payment_amount,
            notes=lesson.notes,
        )
        data = request_data.model_dump(exclude_unset=True)
        new_starts_at = data["starts_at"].replace(tzinfo=None) if data.get("starts_at") is not None else lesson.starts_at
        new_duration = data["duration_minutes"] if data.get("duration_minutes") is not None else lesson.duration_minutes
        if new_starts_at != lesson.starts_at or new_duration != lesson.duration_minutes:
            conflicts = validate_slot(
                state.db,
                new_starts_at,
                new_duration,
                state.work_hours,
                ignore_lesson_id=lesson.id,
            )
            if conflicts:
                raise HTTPException(
                    status_code=409,
                    detail=slot_conflicts_payload(state, conflicts, new_starts_at, new_duration),
                )
            lesson.starts_at = new_starts_at
        for field in ("duration_minutes", "status", "payment_status", "payment_amount", "notes"):
            if field in data and data[field] is not None:
                setattr(lesson, field, data[field])
        if lesson.payment_status == LessonPaymentStatus.CONFIRMED.value and lesson.payment_confirmed_at is None:
            lesson.payment_confirmed_at = now_utc()
        state.db.update_lesson(lesson)
        lesson_changed = (
            old_lesson.starts_at != lesson.starts_at
            or old_lesson.duration_minutes != lesson.duration_minutes
            or old_lesson.status != lesson.status
            or old_lesson.notes != lesson.notes
        )
        payment_changed = (
            old_lesson.payment_status != lesson.payment_status
            or old_lesson.payment_amount != lesson.payment_amount
        )
        student = state.db.get_student(lesson.student_id)
        if lesson_changed:
            notify_student_users_sync(
                state,
                lesson.student_id,
                "\n".join(
                    [
                        "Занятие изменено преподавателем:",
                        student_lesson_time_text(lesson, student, state.settings),
                        f"Статус: {lesson_status_label(lesson.status)}",
                        f"Длительность: {lesson.duration_minutes} мин",
                    ]
                ),
            )
        elif payment_changed:
            notify_student_users_sync(
                state,
                lesson.student_id,
                f"Статус оплаты занятия изменен: {payment_label(lesson.payment_status)}",
            )
        return {"lesson": serialize_lesson(lesson, student, state.settings.timezone)}

    @app.post("/api/admin/lessons/{lesson_id}/confirm")
    def confirm_lesson_request(lesson_id: int, account: UserAccount = current_account_dep) -> dict[str, Any]:
        require_admin(account)
        lesson = state.db.get_lesson(lesson_id)
        if lesson is None:
            raise HTTPException(status_code=404, detail="Урок не найден")
        if lesson.status != LessonStatus.PENDING_CONFIRMATION.value:
            return {"lesson": serialize_lesson(lesson, state.db.get_student(lesson.student_id), state.settings.timezone)}
        student = state.db.get_student(lesson.student_id)
        lesson.status = LessonStatus.PLANNED.value
        state.db.update_lesson(lesson)
        notify_student_users_sync(
            state,
            lesson.student_id,
            f"Занятие подтверждено преподавателем:\n{student_lesson_time_text(lesson, student, state.settings)}",
        )
        return {"lesson": serialize_lesson(lesson, student, state.settings.timezone)}

    @app.post("/api/admin/lessons/{lesson_id}/reject")
    def reject_lesson_request(lesson_id: int, account: UserAccount = current_account_dep) -> dict[str, Any]:
        require_admin(account)
        lesson = state.db.get_lesson(lesson_id)
        if lesson is None:
            raise HTTPException(status_code=404, detail="Урок не найден")
        if is_cancelled(lesson.status):
            return {"lesson": serialize_lesson(lesson, state.db.get_student(lesson.student_id), state.settings.timezone)}
        student = state.db.get_student(lesson.student_id)
        lesson.status = LessonStatus.CANCELLED_BY_TEACHER.value
        lesson.cancellation_reason = "Заявка отклонена преподавателем"
        lesson.cancelled_by = Role.ADMIN.value
        state.db.update_lesson(lesson)
        notify_student_users_sync(
            state,
            lesson.student_id,
            f"Заявка на занятие отклонена преподавателем:\n{student_lesson_time_text(lesson, student, state.settings)}",
        )
        return {"lesson": serialize_lesson(lesson, student, state.settings.timezone)}

    @app.delete("/api/admin/lessons/{lesson_id}")
    def delete_lesson(lesson_id: int, account: UserAccount = current_account_dep) -> dict[str, Any]:
        require_admin(account)
        lesson = state.db.get_lesson(lesson_id)
        if lesson is None:
            raise HTTPException(status_code=404, detail="Урок не найден")
        student = state.db.get_student(lesson.student_id)
        state.db.delete_lesson(lesson_id)
        notify_student_users_sync(
            state,
            lesson.student_id,
            "\n".join(
                [
                    "Занятие удалено преподавателем:",
                    student_lesson_time_text(lesson, student, state.settings),
                ]
            ),
        )
        return {"deleted": True, "lesson_id": lesson_id, "student": serialize_student(student) if student else None}

    @app.post("/api/lessons/{lesson_id}/confirm")
    def confirm_own_lesson(lesson_id: int, account: UserAccount = current_account_dep) -> dict[str, Any]:
        lesson = state.db.get_lesson(lesson_id)
        if lesson is None:
            raise HTTPException(status_code=404, detail="Урок не найден")
        if not account.student_id or account.student_id != lesson.student_id:
            raise HTTPException(status_code=403, detail="Нет доступа к уроку")
        if lesson.status != LessonStatus.PENDING_CONFIRMATION.value:
            raise HTTPException(status_code=400, detail="Это занятие уже обработано")
        lesson.status = LessonStatus.PLANNED.value
        state.db.update_lesson(lesson)
        student = state.db.get_student(lesson.student_id)
        notify_admins_sync(
            state.settings,
            "\n".join(
                [
                    "✅ Ученик подтвердил занятие",
                    "",
                    f"Ученик: {student.full_name if student else 'неизвестно'}",
                    f"Время: {ru_dt_text(lesson.starts_at, state.settings.timezone, state.settings.timezone)}",
                ]
            ),
        )
        return {"lesson": serialize_lesson(lesson, student, state.settings.timezone)}

    @app.post("/api/lessons/{lesson_id}/cancel")
    def cancel_own_lesson(lesson_id: int, account: UserAccount = current_account_dep) -> dict[str, Any]:
        lesson = state.db.get_lesson(lesson_id)
        if lesson is None:
            raise HTTPException(status_code=404, detail="Урок не найден")
        if not can_manage_student_calendar(state, account, lesson.student_id):
            raise HTTPException(status_code=403, detail="Нет прав на изменение календаря")
        lesson = cancel_lesson(state.db, lesson_id, account.role, "отменено через Mini App")
        student = state.db.get_student(lesson.student_id)
        message = "\n".join(
            [
                "❌ Занятие отменено",
                "",
                f"Ученик: {student.full_name if student else 'неизвестно'}",
                f"Время: {ru_dt_text(lesson.starts_at, state.settings.timezone, state.settings.timezone)}",
            ]
        )
        if account.role == Role.ADMIN.value:
            notify_student_users_sync(
                state,
                lesson.student_id,
                f"Преподаватель отменил занятие:\n{student_lesson_time_text(lesson, student, state.settings)}",
            )
        else:
            notify_admins_sync(state.settings, message)
        return {"lesson": serialize_lesson(lesson, student, state.settings.timezone)}

    @app.post("/api/lessons/{lesson_id}/move")
    def move_own_lesson(
        lesson_id: int,
        request_data: LessonMoveRequest,
        account: UserAccount = current_account_dep,
    ) -> dict[str, Any]:
        lesson = state.db.get_lesson(lesson_id)
        if lesson is None:
            raise HTTPException(status_code=404, detail="Урок не найден")
        if not can_manage_student_calendar(state, account, lesson.student_id):
            raise HTTPException(status_code=403, detail="Нет прав на изменение календаря")
        student = state.db.get_student(lesson.student_id)
        if student is None:
            raise HTTPException(status_code=404, detail="Ученик не найден")
        starts_at = (
            request_data.starts_at.replace(tzinfo=None)
            if account.role == Role.ADMIN.value
            else to_teacher_time(request_data.starts_at, student, state.settings)
        )
        conflicts = validate_slot(
            state.db,
            starts_at,
            request_data.duration_minutes,
            state.work_hours,
            ignore_lesson_id=lesson.id,
        )
        if conflicts:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Это время уже занято. Выбери другое свободное окно.",
                    "conflicts": [conflict.message for conflict in conflicts],
                    "suggested_slots": collect_available_slots(
                        state,
                        request_data.duration_minutes,
                        days=14,
                        start_day=starts_at.date(),
                        student=None if account.role == Role.ADMIN.value else student,
                    )[:18],
                },
            )
        lesson.starts_at = starts_at
        lesson.duration_minutes = request_data.duration_minutes
        lesson.status = LessonStatus.PENDING_CONFIRMATION.value
        state.db.update_lesson(lesson)
        if account.role == Role.ADMIN.value:
            notify_student_users_sync(
                state,
                lesson.student_id,
                student_lesson_confirmation_text(lesson, state.settings, student),
                reply_markup=student_lesson_confirmation_reply_markup(lesson.id),
            )
        else:
            notify_admins_sync(
                state.settings,
                "\n".join(
                    [
                        "↪️ Запрос на перенос занятия",
                        "",
                        f"Ученик: {student.full_name if student else 'неизвестно'}",
                        f"Новое время: {ru_dt_text(lesson.starts_at, state.settings.timezone, state.settings.timezone)}",
                        "",
                        "Подтверди заявку или предложи другое время.",
                    ]
                ),
                reply_markup=lesson_request_reply_markup(lesson.id),
            )
        return {"lesson": serialize_lesson(lesson, student, state.settings.timezone)}

    @app.post("/api/lessons/{lesson_id}/mark-paid")
    def mark_lesson_paid(
        lesson_id: int,
        request_data: MarkLessonPaymentRequest,
        account: UserAccount = current_account_dep,
    ) -> dict[str, Any]:
        lesson = state.db.get_lesson(lesson_id)
        if lesson is None:
            raise HTTPException(status_code=404, detail="Урок не найден")
        if not can_access_student(account, lesson.student_id):
            raise HTTPException(status_code=403, detail="Нет доступа к уроку")
        old_payment_status = lesson.payment_status
        actor = request_data.actor or account.role
        if account.role == Role.ADMIN.value:
            lesson.payment_status = LessonPaymentStatus.CONFIRMED.value
            lesson.payment_marked_by = Role.ADMIN.value
            lesson.payment_confirmed_at = now_utc()
        elif actor == Role.PARENT.value or account.role == Role.PARENT.value:
            lesson.payment_status = LessonPaymentStatus.PARENT_MARKED.value
            lesson.payment_marked_by = Role.PARENT.value
        else:
            lesson.payment_status = LessonPaymentStatus.STUDENT_MARKED.value
            lesson.payment_marked_by = Role.STUDENT.value
        state.db.update_lesson(lesson)
        student = state.db.get_student(lesson.student_id)
        if old_payment_status != lesson.payment_status:
            if account.role == Role.ADMIN.value:
                notify_student_users_sync(
                    state,
                    lesson.student_id,
                    f"Оплата занятия подтверждена:\n{student_lesson_time_text(lesson, student, state.settings)}",
                )
            else:
                notify_admins_sync(
                    state.settings,
                    "\n".join(
                        [
                            "Ученик отметил оплату занятия",
                            f"Ученик: {student.full_name if student else 'неизвестно'}",
                            f"Занятие: {ru_dt_text(lesson.starts_at, state.settings.timezone, state.settings.timezone)}",
                        ]
                    ),
                )
        return {"lesson": serialize_lesson(lesson, student, state.settings.timezone)}

    @app.post("/api/admin/homework")
    def create_homework(request_data: HomeworkWrite, account: UserAccount = current_account_dep) -> dict[str, Any]:
        require_admin(account)
        student = state.db.get_student(request_data.student_id)
        if student is None:
            raise HTTPException(status_code=404, detail="Ученик не найден")
        homework = state.db.add_homework(
            Homework(
                student_id=request_data.student_id,
                title=request_data.title,
                text=request_data.text,
                estimated_minutes=request_data.estimated_minutes,
                deadline=request_data.deadline,
                status=request_data.status,
                materials=request_data.attachments,
                links=request_data.links,
                teacher_comment=request_data.teacher_comment,
            )
        )
        notify_student_users_sync(
            state,
            request_data.student_id,
            "\n".join(
                [
                    "Новое домашнее задание",
                    homework.title or "Домашнее задание",
                    homework.text,
                ]
            ),
        )
        return {"homework": serialize_homework(homework, student)}

    @app.patch("/api/admin/homework/{homework_id}")
    def update_homework(
        homework_id: int,
        request_data: HomeworkUpdate,
        account: UserAccount = current_account_dep,
    ) -> dict[str, Any]:
        require_admin(account)
        homework = state.db.get_homework(homework_id)
        if homework is None:
            raise HTTPException(status_code=404, detail="Домашка не найдена")
        old_homework = Homework(
            id=homework.id,
            student_id=homework.student_id,
            title=homework.title,
            text=homework.text,
            estimated_minutes=homework.estimated_minutes,
            deadline=homework.deadline,
            status=homework.status,
            materials=list(homework.materials),
            links=list(homework.links),
            teacher_comment=homework.teacher_comment,
            created_at=homework.created_at,
            updated_at=homework.updated_at,
            checked_at=homework.checked_at,
        )
        data = request_data.model_dump(exclude_unset=True)
        for field, value in data.items():
            if field == "attachments" and value is not None:
                homework.materials = value
                continue
            if value is not None and hasattr(homework, field):
                setattr(homework, field, value)
        homework.updated_at = now_utc()
        state.db.update_homework(homework)
        if (
            old_homework.title != homework.title
            or old_homework.text != homework.text
            or old_homework.estimated_minutes != homework.estimated_minutes
            or old_homework.deadline != homework.deadline
            or old_homework.status != homework.status
            or old_homework.materials != homework.materials
            or old_homework.links != homework.links
            or old_homework.teacher_comment != homework.teacher_comment
        ):
            notify_student_users_sync(
                state,
                homework.student_id,
                "\n".join(
                    [
                        "Домашнее задание изменено",
                        homework.title or "Домашнее задание",
                        f"Статус: {homework_status_label(homework.status)}",
                    ]
                ),
            )
        return {"homework": serialize_homework(homework, state.db.get_student(homework.student_id))}

    @app.delete("/api/admin/homework/{homework_id}")
    def delete_homework(homework_id: int, account: UserAccount = current_account_dep) -> dict[str, Any]:
        require_admin(account)
        homework = state.db.get_homework(homework_id)
        if homework is None:
            raise HTTPException(status_code=404, detail="Домашка не найдена")
        state.db.delete_homework(homework_id)
        return {"deleted": True, "homework_id": homework_id}

    @app.post("/api/homework/{homework_id}/submit")
    def submit_homework_answer(
        homework_id: int,
        request_data: HomeworkSubmitRequest,
        account: UserAccount = current_account_dep,
    ) -> dict[str, Any]:
        homework = state.db.get_homework(homework_id)
        if not homework or not account.student_id or homework.student_id != account.student_id:
            raise HTTPException(status_code=404, detail="Домашка не найдена")
        submit_homework(state.db, homework_id, account.student_id, request_data.text)
        student = state.db.get_student(account.student_id)
        notify_admins_sync(
            state.settings,
            "\n".join(
                [
                    "Ученик сдал домашнее задание",
                    f"Ученик: {student.full_name if student else 'неизвестно'}",
                    f"ДЗ: {homework.title or f'#{homework.id}'}",
                ]
            ),
        )
        return {"homework": serialize_homework(state.db.get_homework(homework_id))}

    @app.post("/api/payment")
    def create_payment(request_data: PaymentRequest, account: UserAccount = current_account_dep) -> dict[str, Any]:
        if not account.student_id:
            raise HTTPException(status_code=403, detail="Только ученик или родитель может отметить оплату")
        if request_data.lesson_id:
            lesson = state.db.get_lesson(request_data.lesson_id)
            if lesson is None or lesson.student_id != account.student_id:
                raise HTTPException(status_code=404, detail="Урок не найден")
            lesson.payment_status = (
                LessonPaymentStatus.PARENT_MARKED.value
                if account.role == Role.PARENT.value
                else LessonPaymentStatus.STUDENT_MARKED.value
            )
            lesson.payment_marked_by = account.role
            state.db.update_lesson(lesson)
        if request_data.amount <= 0 and request_data.lessons_count <= 0:
            raise HTTPException(status_code=400, detail="Укажи сумму или количество занятий")
        payment = state.db.add_payment(
            Payment(
                student_id=account.student_id,
                lesson_id=request_data.lesson_id,
                amount=request_data.amount,
                lessons_count=request_data.lessons_count,
                sender_role=account.role,
                sender_telegram_id=account.telegram_id,
                status=PaymentStatus.PENDING.value,
                comment=request_data.comment.strip(),
            )
        )
        student = state.db.get_student(account.student_id)
        notify_admins_sync(
            state.settings,
            "\n".join(
                [
                    "Новая отметка об оплате",
                    f"Ученик: {student.full_name if student else 'неизвестно'}",
                    f"Сумма: {payment.amount} ₽",
                    f"Занятий: {payment.lessons_count}",
                ]
            ),
        )
        return {"payment": serialize_payment(payment, student)}

    @app.post("/api/admin/payments")
    def create_admin_payment(
        request_data: AdminPaymentWrite,
        account: UserAccount = current_account_dep,
    ) -> dict[str, Any]:
        require_admin(account)
        student = state.db.get_student(request_data.student_id)
        if student is None:
            raise HTTPException(status_code=404, detail="Ученик не найден")
        if request_data.amount <= 0 and request_data.lessons_count <= 0:
            raise HTTPException(status_code=400, detail="Укажи сумму или количество занятий")
        payment = state.db.add_payment(
            Payment(
                student_id=request_data.student_id,
                lesson_id=request_data.lesson_id,
                amount=request_data.amount,
                lessons_count=request_data.lessons_count,
                sender_role=Role.ADMIN.value,
                status=PaymentStatus.PENDING.value,
                comment=request_data.comment.strip(),
            )
        )
        payment = confirm_payment(state.db, payment.id)
        notify_student_users_sync(
            state,
            payment.student_id,
            "\n".join(
                [
                    "Оплата добавлена преподавателем",
                    f"Сумма: {payment.amount} ₽",
                    f"Занятий: {payment.lessons_count}",
                ]
            ),
        )
        return {"payment": serialize_payment(payment, state.db.get_student(payment.student_id))}

    @app.patch("/api/me/timezone")
    def update_my_timezone(request_data: TimezoneUpdate, account: UserAccount = current_account_dep) -> dict[str, Any]:
        if not account.student_id:
            raise HTTPException(status_code=403, detail="Аккаунт не привязан к ученику")
        student = state.db.get_student(account.student_id)
        if student is None:
            raise HTTPException(status_code=404, detail="Ученик не найден")
        student.timezone = normalize_timezone_or_400(request_data.timezone, student.timezone)
        state.db.update_student(student)
        return {"student": serialize_student(student)}

    @app.get("/api/available-slots")
    def get_available_slots(
        duration_minutes: int = 60,
        days: int = 14,
        student_id: int | None = None,
        account: UserAccount = current_account_dep,
    ) -> dict[str, Any]:
        if duration_minutes < 30 or duration_minutes > 240:
            raise HTTPException(status_code=400, detail="Длительность должна быть от 30 до 240 минут")
        if days < 1 or days > 31:
            raise HTTPException(status_code=400, detail="Период должен быть от 1 до 31 дня")
        student = None
        if account.role == Role.ADMIN.value:
            if student_id is not None:
                student = state.db.get_student(student_id)
                if student is None:
                    raise HTTPException(status_code=404, detail="Ученик не найден")
        elif not account.student_id:
            raise HTTPException(status_code=403, detail="Аккаунт не привязан к ученику")
        else:
            student = state.db.get_student(account.student_id)
        return {
            "duration_minutes": duration_minutes,
            "days": days,
            "slots": collect_available_slots(state, duration_minutes, days=days, student=student),
        }

    @app.post("/api/book")
    def book_lesson(request_data: BookRequest, account: UserAccount = current_account_dep) -> dict[str, Any]:
        if not account.student_id:
            raise HTTPException(status_code=403, detail="Только ученик может записаться")
        student = state.db.get_student(account.student_id)
        if student is None:
            raise HTTPException(status_code=404, detail="Ученик не найден")
        starts_at = to_teacher_time(request_data.starts_at, student, state.settings)
        try:
            lesson = add_single_lesson(
                state.db,
                account.student_id,
                starts_at,
                request_data.duration_minutes,
                state.work_hours,
            )
        except SlotUnavailableError as exc:
            raise HTTPException(
                status_code=409,
                detail=slot_unavailable_payload(state, exc, starts_at, request_data.duration_minutes, student),
            ) from exc
        lesson.status = LessonStatus.PENDING_CONFIRMATION.value
        state.db.update_lesson(lesson)
        notify_admins_sync(
            state.settings,
            "\n".join(
                [
                    "🗓 Новая заявка на занятие",
                    "",
                    f"Ученик: {student.full_name if student else 'неизвестно'}",
                    f"Время: {ru_dt_text(lesson.starts_at, state.settings.timezone, state.settings.timezone)}",
                    f"Длительность: {lesson.duration_minutes} мин",
                    "",
                    "Можно подтвердить или предложить перенос.",
                ]
            ),
            reply_markup=lesson_request_reply_markup(lesson.id),
        )
        return {"lesson": serialize_lesson(lesson, student, state.settings.timezone)}

    @app.post("/api/schedule-rules")
    def create_schedule_rule(
        request_data: ScheduleRuleWrite,
        account: UserAccount = current_account_dep,
    ) -> dict[str, Any]:
        student_id = request_data.student_id if account.role == Role.ADMIN.value else account.student_id
        if not student_id:
            raise HTTPException(status_code=403, detail="Укажи ученика для расписания")
        if account.role != Role.ADMIN.value and not can_manage_student_calendar(state, account, student_id):
            raise HTTPException(status_code=403, detail="Нет прав на изменение календаря")
        student = state.db.get_student(student_id)
        if student is None:
            raise HTTPException(status_code=404, detail="Ученик не найден")
        raw_slots = request_data.slots or [
            ScheduleSlotWrite(weekday=int(day), lesson_time=request_data.lesson_time)
            for day in request_data.weekdays
            if 1 <= int(day) <= 7
        ]
        unique_slots = sorted({(slot.weekday, slot.lesson_time) for slot in raw_slots})
        if not unique_slots:
            raise HTTPException(status_code=400, detail="Добавь хотя бы один день и время")
        starts_at = request_data.starts_at or date.today()
        ends_at = request_data.ends_at or starts_at + timedelta(days=56)
        rules = [
            state.db.add_schedule_rule(
                ScheduleRule(
                    student_id=student_id,
                    weekdays=[weekday],
                    lesson_time=lesson_time,
                    duration_minutes=request_data.duration_minutes,
                    starts_at=starts_at,
                    ends_at=ends_at,
                )
            )
            for weekday, lesson_time in unique_slots
        ]
        recurring_slots = [
            RecurringLessonSlot(
                weekdays={weekday},
                lesson_time=time(*[int(part) for part in lesson_time.split(":", 1)]),
            )
            for weekday, lesson_time in unique_slots
        ]
        try:
            if account.role == Role.ADMIN.value:
                result = create_recurring_lessons_for_slots(
                    state.db,
                    student_id,
                    starts_at,
                    ends_at,
                    recurring_slots,
                    request_data.duration_minutes,
                    state.work_hours,
                )
            else:
                result = create_recurring_lessons_for_local_slots(
                    state.db,
                    student_id,
                    starts_at,
                    ends_at,
                    recurring_slots,
                    request_data.duration_minutes,
                    state.work_hours,
                    student.timezone,
                    state.settings.timezone,
                )
        except SlotUnavailableError as exc:
            raise HTTPException(status_code=409, detail=[conflict.message for conflict in exc.conflicts]) from exc
        if account.role == Role.ADMIN.value:
            for lesson in result.created:
                lesson.status = LessonStatus.PENDING_CONFIRMATION.value
                state.db.update_lesson(lesson)
            if result.created:
                notify_student_users_sync(
                    state,
                    student_id,
                    student_lesson_confirmation_text(result.created[0], state.settings, student),
                    reply_markup=student_lesson_confirmation_reply_markup(result.created[0].id),
                )
        else:
            for lesson in result.created:
                lesson.status = LessonStatus.PENDING_CONFIRMATION.value
                state.db.update_lesson(lesson)
            notify_admins_sync(
                state.settings,
                "\n".join(
                    [
                        "🗓 Новая заявка на стабильное расписание",
                        "",
                        student.full_name,
                        ", ".join(f"{weekdays}: {lesson_time}" for weekdays, lesson_time in unique_slots),
                        "",
                        "Занятия уже добавлены как заявки на подтверждение.",
                    ]
                ),
                reply_markup=lesson_request_reply_markup(result.created[0].id if result.created else None),
            )
        return {
            "rules": [asdict(rule) for rule in rules],
            "created": [serialize_lesson(lesson, student, state.settings.timezone) for lesson in result.created],
            "skipped": [conflict.message for conflict in result.skipped],
        }

    @app.post("/api/admin/closed-slots")
    def create_closed_slot(request_data: ClosedSlotWrite, account: UserAccount = current_account_dep) -> dict[str, Any]:
        require_admin(account)
        starts_at = request_data.starts_at.replace(tzinfo=None)
        ends_at = request_data.ends_at.replace(tzinfo=None)
        if ends_at <= starts_at:
            raise HTTPException(status_code=400, detail="Конец должен быть позже начала")
        slot = state.db.add_closed_slot(
            ClosedSlot(
                starts_at=starts_at,
                ends_at=ends_at,
                reason=request_data.reason.strip(),
            )
        )
        return {"slot": asdict(slot)}

    @app.delete("/api/admin/closed-slots/{slot_id}")
    def delete_closed_slot(slot_id: int, account: UserAccount = current_account_dep) -> dict[str, Any]:
        require_admin(account)
        slot = state.db.get_closed_slot(slot_id)
        if slot is None:
            raise HTTPException(status_code=404, detail="Нерабочее время не найдено")
        state.db.delete_closed_slot(slot_id)
        return {"ok": True}

    @app.patch("/api/students/{student_id}/progress")
    def update_task_progress(
        student_id: int,
        request_data: ProgressUpdate,
        account: UserAccount = current_account_dep,
    ) -> dict[str, Any]:
        if account.role == Role.PARENT.value:
            raise HTTPException(status_code=403, detail="Родитель может смотреть прогресс, но не редактировать")
        if account.role != Role.ADMIN.value and account.student_id != student_id:
            raise HTTPException(status_code=403, detail="Нет доступа к ученику")
        student = state.db.get_student(student_id)
        if student is None:
            raise HTTPException(status_code=404, detail="Ученик не найден")
        raw_title = (request_data.title or "").strip()
        if request_data.task_number is None and not raw_title:
            raise HTTPException(status_code=400, detail="Выбери задание или укажи название темы")
        exam_goal = default_progress_goal(student.prep_type, student.subject)
        if request_data.task_number is not None:
            if exam_goal > 0 and request_data.task_number > exam_goal:
                raise HTTPException(
                    status_code=400,
                    detail=f"Для выбранного экзамена доступны задания с 1 по {exam_goal}",
                )
            title = f"Задание {request_data.task_number}"
            if student.progress_goal <= 0:
                student.progress_goal = max(request_data.task_number, 1)
        else:
            title = raw_title
        topic = state.db.find_prep_topic_by_title(student_id, title)
        if topic is None:
            topic = PrepTopic(student_id=student_id, title=title)
        if request_data.knowledge_level is not None:
            topic.knowledge_level = request_data.knowledge_level
        topic.status = knowledge_status(topic.knowledge_level)
        if request_data.comment is not None:
            topic.comment = request_data.comment.strip()
        state.db.upsert_prep_topic(topic)

        topics = state.db.list_prep_topics(student_id)
        relevant_topics = topics
        if exam_goal > 0:
            relevant_topics = [
                item
                for item in topics
                if 0 < (topic_number(item.title) or 0) <= exam_goal
            ]
            student.progress_goal = exam_goal
        student.progress_current = sum(1 for item in relevant_topics if item.knowledge_level >= 7)
        if request_data.task_number is not None and exam_goal <= 0:
            student.progress_goal = max(student.progress_goal, request_data.task_number, len(topics))
        elif student.progress_goal <= 0:
            student.progress_goal = len(topics)
        state.db.update_student(student)
        return {
            "student": serialize_student(student),
            "topics": serialize_topics(topics),
        }

    @app.delete("/api/students/{student_id}/progress/{topic_id}/note")
    def delete_task_progress_note(
        student_id: int,
        topic_id: int,
        account: UserAccount = current_account_dep,
    ) -> dict[str, Any]:
        if account.role == Role.PARENT.value:
            raise HTTPException(status_code=403, detail="Родитель может смотреть прогресс, но не редактировать")
        if account.role != Role.ADMIN.value and account.student_id != student_id:
            raise HTTPException(status_code=403, detail="Нет доступа к ученику")
        topic = state.db.get_prep_topic(topic_id)
        if topic is None or topic.student_id != student_id:
            raise HTTPException(status_code=404, detail="Заметка не найдена")
        state.db.delete_prep_topic_note(topic_id)
        return {"topics": serialize_topics(state.db.list_prep_topics(student_id))}

    @app.post("/api/students/{student_id}/plan")
    def create_plan_item(
        student_id: int,
        request_data: PlanItemWrite,
        account: UserAccount = current_account_dep,
    ) -> dict[str, Any]:
        if account.role == Role.PARENT.value:
            raise HTTPException(status_code=403, detail="Родитель может смотреть план, но не редактировать")
        if account.role != Role.ADMIN.value and account.student_id != student_id:
            raise HTTPException(status_code=403, detail="Нет доступа к ученику")
        student = state.db.get_student(student_id)
        if student is None:
            raise HTTPException(status_code=404, detail="Ученик не найден")
        plan = state.db.list_plan_items(student_id)
        item = state.db.upsert_plan_item(
            PlanItem(
                student_id=student_id,
                title=request_data.title.strip(),
                position=(max((entry.position for entry in plan), default=0) + 1),
                comment=request_data.comment.strip(),
                deadline=request_data.deadline,
            )
        )
        return {"plan": [serialize_plan_item(entry) for entry in state.db.list_plan_items(student_id)], "item": serialize_plan_item(item)}

    @app.patch("/api/students/{student_id}/plan/{item_id}")
    def update_plan_item(
        student_id: int,
        item_id: int,
        request_data: PlanItemUpdate,
        account: UserAccount = current_account_dep,
    ) -> dict[str, Any]:
        if account.role == Role.PARENT.value:
            raise HTTPException(status_code=403, detail="Родитель может смотреть план, но не редактировать")
        if account.role != Role.ADMIN.value and account.student_id != student_id:
            raise HTTPException(status_code=403, detail="Нет доступа к ученику")
        item = state.db.get_plan_item(item_id)
        if item is None or item.student_id != student_id:
            raise HTTPException(status_code=404, detail="Пункт плана не найден")
        data = request_data.model_dump(exclude_unset=True)
        if "title" in data and data["title"] is not None:
            item.title = data["title"].strip()
        if "deadline" in data:
            item.deadline = data["deadline"]
        if "comment" in data and data["comment"] is not None:
            item.comment = data["comment"].strip()
        if "status" in data and data["status"] is not None:
            if data["status"] not in {status.value for status in PlanItemStatus}:
                raise HTTPException(status_code=400, detail="Неподдерживаемый статус плана")
            item.status = data["status"]
        state.db.upsert_plan_item(item)
        return {"plan": [serialize_plan_item(entry) for entry in state.db.list_plan_items(student_id)], "item": serialize_plan_item(item)}

    @app.post("/api/admin/payments/{payment_id}")
    def admin_payment_decision(
        payment_id: int,
        request_data: AdminPaymentDecision,
        account: UserAccount = current_account_dep,
    ) -> dict[str, Any]:
        require_admin(account)
        payment = state.db.get_payment(payment_id)
        if payment is None:
            raise HTTPException(status_code=404, detail="Платеж не найден")
        if request_data.action == "reject":
            reject_payment(state.db, payment_id, request_data.comment)
        elif request_data.action == "confirm":
            payment = confirm_payment(state.db, payment_id)
        else:
            raise HTTPException(status_code=400, detail="Неподдерживаемое действие")
        payment = state.db.get_payment(payment_id)
        notify_student_users_sync(
            state,
            payment.student_id,
            "Оплата подтверждена." if request_data.action == "confirm" else "Оплату нужно проверить и отправить повторно.",
        )
        return {"payment": serialize_payment(payment, state.db.get_student(payment.student_id))}

    return app


app = create_app()
