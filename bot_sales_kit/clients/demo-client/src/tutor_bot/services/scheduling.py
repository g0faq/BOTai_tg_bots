from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Protocol
from uuid import uuid4

from tutor_bot.domain.enums import LessonStatus, Role
from tutor_bot.domain.models import ClosedSlot, Lesson
from tutor_bot.services.timezones import convert_timezone


class ScheduleStorage(Protocol):
    def add_lesson(self, lesson: Lesson) -> Lesson: ...

    def update_lesson(self, lesson: Lesson) -> None: ...

    def get_lesson(self, lesson_id: int) -> Lesson | None: ...

    def list_lessons_between(
        self,
        starts_at: datetime,
        ends_at: datetime,
        include_cancelled: bool = False,
    ) -> list[Lesson]: ...

    def list_closed_slots_between(self, starts_at: datetime, ends_at: datetime) -> list[ClosedSlot]: ...

    def list_student_lessons(self, student_id: int, limit: int = 20) -> list[Lesson]: ...


@dataclass(frozen=True, slots=True)
class WorkHours:
    weekdays: set[int]
    starts_at: time
    ends_at: time
    slot_step_minutes: int = 30

    def contains(self, starts_at: datetime, duration_minutes: int) -> bool:
        ends_at = starts_at + timedelta(minutes=duration_minutes)
        if starts_at.date() != ends_at.date():
            return False
        if starts_at.isoweekday() not in self.weekdays:
            return False
        return starts_at.time() >= self.starts_at and ends_at.time() <= self.ends_at


@dataclass(frozen=True, slots=True)
class SlotConflict:
    kind: str
    message: str
    starts_at: datetime | None = None
    ends_at: datetime | None = None


@dataclass(slots=True)
class RecurringCreateResult:
    created: list[Lesson] = field(default_factory=list)
    skipped: list[SlotConflict] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class RecurringLessonSlot:
    weekdays: set[int]
    lesson_time: time


class SlotUnavailableError(ValueError):
    def __init__(self, conflicts: list[SlotConflict]) -> None:
        self.conflicts = conflicts
        super().__init__("slot is unavailable")


def overlaps(
    left_start: datetime,
    left_end: datetime,
    right_start: datetime,
    right_end: datetime,
) -> bool:
    return left_start < right_end and right_start < left_end


def slot_end(starts_at: datetime, duration_minutes: int) -> datetime:
    return starts_at + timedelta(minutes=duration_minutes)


def validate_slot(
    storage: ScheduleStorage,
    starts_at: datetime,
    duration_minutes: int,
    work_hours: WorkHours,
    ignore_lesson_id: int | None = None,
) -> list[SlotConflict]:
    ends_at = slot_end(starts_at, duration_minutes)
    conflicts: list[SlotConflict] = []

    if not work_hours.contains(starts_at, duration_minutes):
        conflicts.append(
            SlotConflict(
                kind="work_hours",
                message="Время вне рабочих часов преподавателя.",
                starts_at=starts_at,
                ends_at=ends_at,
            )
        )

    for lesson in storage.list_lessons_between(starts_at, ends_at, include_cancelled=False):
        if ignore_lesson_id is not None and lesson.id == ignore_lesson_id:
            continue
        if lesson.status in {LessonStatus.PLANNED.value, LessonStatus.PENDING_CONFIRMATION.value} and overlaps(
            starts_at, ends_at, lesson.starts_at, lesson.ends_at
        ):
            conflicts.append(
                SlotConflict(
                    kind="lesson",
                    message=f"Слот занят занятием #{lesson.id}.",
                    starts_at=lesson.starts_at,
                    ends_at=lesson.ends_at,
                )
            )

    for closed in storage.list_closed_slots_between(starts_at, ends_at):
        if overlaps(starts_at, ends_at, closed.starts_at, closed.ends_at):
            reason = f": {closed.reason}" if closed.reason else ""
            conflicts.append(
                SlotConflict(
                    kind="closed_slot",
                    message=f"Слот закрыт{reason}.",
                    starts_at=closed.starts_at,
                    ends_at=closed.ends_at,
                )
            )

    return conflicts


def add_single_lesson(
    storage: ScheduleStorage,
    student_id: int,
    starts_at: datetime,
    duration_minutes: int,
    work_hours: WorkHours,
    stable_series_id: str = "",
) -> Lesson:
    conflicts = validate_slot(storage, starts_at, duration_minutes, work_hours)
    if conflicts:
        raise SlotUnavailableError(conflicts)
    return storage.add_lesson(
        Lesson(
            student_id=student_id,
            starts_at=starts_at,
            duration_minutes=duration_minutes,
            stable_series_id=stable_series_id,
        )
    )


def move_lesson(
    storage: ScheduleStorage,
    lesson_id: int,
    starts_at: datetime,
    duration_minutes: int,
    work_hours: WorkHours,
) -> Lesson:
    lesson = storage.get_lesson(lesson_id)
    if lesson is None:
        raise ValueError("lesson not found")
    if lesson.status != LessonStatus.PLANNED.value:
        raise ValueError("only planned lesson can be moved")
    conflicts = validate_slot(
        storage,
        starts_at,
        duration_minutes,
        work_hours,
        ignore_lesson_id=lesson.id,
    )
    if conflicts:
        raise SlotUnavailableError(conflicts)
    lesson.starts_at = starts_at
    lesson.duration_minutes = duration_minutes
    storage.update_lesson(lesson)
    return lesson


def create_recurring_lessons(
    storage: ScheduleStorage,
    student_id: int,
    from_date: date,
    until: date,
    weekdays: set[int],
    lesson_time: time,
    duration_minutes: int,
    work_hours: WorkHours,
) -> RecurringCreateResult:
    if until < from_date:
        raise ValueError("until date must be greater than or equal to from_date")
    series_id = uuid4().hex
    result = RecurringCreateResult()
    current = from_date
    while current <= until:
        if current.isoweekday() in weekdays:
            starts_at = datetime.combine(current, lesson_time, tzinfo=work_hours_timezone(work_hours))
            conflicts = validate_slot(storage, starts_at, duration_minutes, work_hours)
            if conflicts:
                result.skipped.extend(conflicts)
            else:
                result.created.append(
                    storage.add_lesson(
                        Lesson(
                            student_id=student_id,
                            starts_at=starts_at,
                            duration_minutes=duration_minutes,
                            stable_series_id=series_id,
                        )
                    )
                )
        current += timedelta(days=1)
    return result


def create_recurring_lessons_for_slots(
    storage: ScheduleStorage,
    student_id: int,
    from_date: date,
    until: date,
    slots: list[RecurringLessonSlot],
    duration_minutes: int,
    work_hours: WorkHours,
) -> RecurringCreateResult:
    if until < from_date:
        raise ValueError("until date must be greater than or equal to from_date")
    if not slots:
        raise ValueError("at least one recurring slot is required")

    series_id = uuid4().hex
    result = RecurringCreateResult()
    current = from_date
    while current <= until:
        for slot in slots:
            if current.isoweekday() not in slot.weekdays:
                continue
            starts_at = datetime.combine(current, slot.lesson_time, tzinfo=work_hours_timezone(work_hours))
            conflicts = validate_slot(storage, starts_at, duration_minutes, work_hours)
            if conflicts:
                result.skipped.extend(conflicts)
            else:
                result.created.append(
                    storage.add_lesson(
                        Lesson(
                            student_id=student_id,
                            starts_at=starts_at,
                            duration_minutes=duration_minutes,
                            stable_series_id=series_id,
                        )
                    )
                )
        current += timedelta(days=1)
    return result


def create_recurring_lessons_for_local_slots(
    storage: ScheduleStorage,
    student_id: int,
    from_date: date,
    until: date,
    slots: list[RecurringLessonSlot],
    duration_minutes: int,
    work_hours: WorkHours,
    source_timezone: str,
    target_timezone: str,
) -> RecurringCreateResult:
    if until < from_date:
        raise ValueError("until date must be greater than or equal to from_date")
    if not slots:
        raise ValueError("at least one recurring slot is required")

    series_id = uuid4().hex
    result = RecurringCreateResult()
    current = from_date
    while current <= until:
        for slot in slots:
            if current.isoweekday() not in slot.weekdays:
                continue
            local_starts_at = datetime.combine(current, slot.lesson_time)
            starts_at = convert_timezone(local_starts_at, source_timezone, target_timezone).replace(tzinfo=None)
            conflicts = validate_slot(storage, starts_at, duration_minutes, work_hours)
            if conflicts:
                result.skipped.extend(conflicts)
            else:
                result.created.append(
                    storage.add_lesson(
                        Lesson(
                            student_id=student_id,
                            starts_at=starts_at,
                            duration_minutes=duration_minutes,
                            stable_series_id=series_id,
                        )
                    )
                )
        current += timedelta(days=1)
    return result


def work_hours_timezone(work_hours: WorkHours):
    return getattr(work_hours.starts_at, "tzinfo", None)


def available_slots(
    storage: ScheduleStorage,
    day: date,
    duration_minutes: int,
    work_hours: WorkHours,
) -> list[datetime]:
    slots: list[datetime] = []
    if day.isoweekday() not in work_hours.weekdays:
        return slots

    current = datetime.combine(day, work_hours.starts_at)
    end_of_work = datetime.combine(day, work_hours.ends_at)
    while current + timedelta(minutes=duration_minutes) <= end_of_work:
        if not validate_slot(storage, current, duration_minutes, work_hours):
            slots.append(current)
        current += timedelta(minutes=work_hours.slot_step_minutes)
    return slots


def cancel_lesson(
    storage: ScheduleStorage,
    lesson_id: int,
    actor_role: str,
    reason: str = "",
) -> Lesson:
    lesson = storage.get_lesson(lesson_id)
    if lesson is None:
        raise ValueError("lesson not found")
    if lesson.charged:
        raise ValueError("charged lesson cannot be cancelled")

    if actor_role == Role.ADMIN.value:
        lesson.status = LessonStatus.CANCELLED_BY_TEACHER.value
    elif actor_role == Role.PARENT.value:
        lesson.status = LessonStatus.CANCELLED_BY_PARENT.value
    else:
        lesson.status = LessonStatus.CANCELLED_BY_STUDENT.value
    lesson.cancelled_by = actor_role
    lesson.cancellation_reason = reason
    storage.update_lesson(lesson)
    return lesson


def clear_future_stable_lessons(
    storage: ScheduleStorage,
    student_id: int,
    now: datetime,
    actor_role: str,
) -> int:
    cleared = 0
    for lesson in storage.list_student_lessons(student_id, limit=10000):
        if not lesson.stable_series_id:
            continue
        if lesson.status != LessonStatus.PLANNED.value:
            continue
        if lesson.starts_at < now:
            continue
        if lesson.charged:
            continue
        if actor_role == Role.ADMIN.value:
            lesson.status = LessonStatus.CANCELLED_BY_TEACHER.value
        elif actor_role == Role.PARENT.value:
            lesson.status = LessonStatus.CANCELLED_BY_PARENT.value
        else:
            lesson.status = LessonStatus.CANCELLED_BY_STUDENT.value
        lesson.cancelled_by = actor_role
        lesson.cancellation_reason = "очищено стабильное расписание"
        storage.update_lesson(lesson)
        cleared += 1
    return cleared


def next_planned_lesson(lessons: list[Lesson], now: datetime) -> Lesson | None:
    planned = [
        lesson
        for lesson in lessons
        if lesson.status == LessonStatus.PLANNED.value and lesson.starts_at >= now
    ]
    return min(planned, key=lambda lesson: lesson.starts_at) if planned else None
