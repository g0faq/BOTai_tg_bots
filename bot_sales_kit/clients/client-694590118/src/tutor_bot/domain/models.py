from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from tutor_bot.domain.enums import (
    BalanceMode,
    HomeworkStatus,
    LessonPaymentStatus,
    LessonStatus,
    PaymentStatus,
    PlanItemStatus,
    PrepTopicStatus,
    PrepType,
    Role,
    StudentStatus,
)


@dataclass(slots=True)
class StudentProfile:
    id: int | None = None
    full_name: str = ""
    grade: str = ""
    prep_type: str = PrepType.OTHER.value
    subject: str = ""
    goal: str = ""
    current_level: str = ""
    lesson_price: int = 0
    price_60: int = 0
    price_90: int = 0
    price_120: int = 0
    lesson_duration_minutes: int = 60
    lesson_format: str = ""
    board_url: str = ""
    meeting_url: str = ""
    student_telegram: str = ""
    parent_telegram: str = ""
    parent_name: str = ""
    parent_can_edit: bool = False
    payer: str = ""
    timezone: str = "Europe/Moscow"
    preferred_days_times: str = ""
    start_date: date | None = None
    exam_date: date | None = None
    comment: str = ""
    status: str = StudentStatus.LEAD.value
    balance_mode: str = BalanceMode.LESSONS.value
    balance_lessons: int = 0
    balance_money: int = 0
    progress_current: int = 0
    progress_goal: int = 0
    prep_plan_text: str = ""
    prep_plan_file_id: str = ""
    debt_reminder_sent_on: date | None = None
    created_at: datetime | None = None


@dataclass(slots=True)
class UserAccount:
    telegram_id: int
    role: str = Role.STUDENT.value
    student_id: int | None = None
    username: str = ""
    full_name: str = ""
    created_at: datetime | None = None


@dataclass(slots=True)
class Lesson:
    student_id: int
    starts_at: datetime
    duration_minutes: int
    id: int | None = None
    status: str = LessonStatus.PLANNED.value
    topic: str = ""
    homework_id: int | None = None
    charged: bool = False
    cancellation_reason: str = ""
    cancelled_by: str = ""
    next_plan: str = ""
    stable_series_id: str = ""
    reminder_sent_at: datetime | None = None
    post_lesson_reminder_sent_at: datetime | None = None
    payment_status: str = LessonPaymentStatus.NOT_MARKED.value
    payment_marked_by: str = ""
    payment_confirmed_at: datetime | None = None
    payment_amount: int = 0
    notes: str = ""
    created_at: datetime | None = None

    @property
    def ends_at(self) -> datetime:
        from datetime import timedelta

        return self.starts_at + timedelta(minutes=self.duration_minutes)


@dataclass(slots=True)
class ClosedSlot:
    starts_at: datetime
    ends_at: datetime
    id: int | None = None
    reason: str = ""
    created_at: datetime | None = None


@dataclass(slots=True)
class Payment:
    student_id: int
    amount: int
    lessons_count: int
    sender_role: str
    id: int | None = None
    lesson_id: int | None = None
    sender_telegram_id: int | None = None
    receipt_file_id: str = ""
    status: str = PaymentStatus.PENDING.value
    comment: str = ""
    balance_after_lessons: int | None = None
    balance_after_money: int | None = None
    created_at: datetime | None = None
    confirmed_at: datetime | None = None


@dataclass(slots=True)
class Homework:
    student_id: int
    text: str
    id: int | None = None
    title: str = ""
    estimated_minutes: int = 0
    deadline: datetime | None = None
    status: str = HomeworkStatus.ASSIGNED.value
    materials: list[str] = field(default_factory=list)
    links: list[str] = field(default_factory=list)
    teacher_comment: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None
    checked_at: datetime | None = None


@dataclass(slots=True)
class ScheduleRule:
    student_id: int
    weekdays: list[int]
    lesson_time: str
    duration_minutes: int
    id: int | None = None
    starts_at: date | None = None
    ends_at: date | None = None
    is_active: bool = True
    created_at: datetime | None = None


@dataclass(slots=True)
class HomeworkSubmission:
    homework_id: int
    student_id: int
    content: str
    id: int | None = None
    file_ids: list[str] = field(default_factory=list)
    created_at: datetime | None = None


@dataclass(slots=True)
class PrepTopic:
    student_id: int
    title: str
    id: int | None = None
    status: str = PrepTopicStatus.NOT_STARTED.value
    solved_count: int = 0
    knowledge_level: int = 0
    comment: str = ""


@dataclass(slots=True)
class PlanItem:
    student_id: int
    title: str
    id: int | None = None
    position: int = 0
    status: str = PlanItemStatus.NOT_STARTED.value
    comment: str = ""
    deadline: date | None = None
