"""Очистка стабильного расписания ученика.

Удаляет правила повторяющихся занятий и переводит будущие незанятые слоты в
статус «отменено» — они уезжают в архив календаря.

Границы намеренно узкие:

* строки занятий НЕ удаляются никогда, только меняется статус;
* прошедшее, проведённое и оплаченное не трогается ни при каких условиях;
* балансы, авансы и выручка не пересчитываются — этим занимаются другие
  модули, и у них есть известные дефекты.

Предпросмотр и фактическая отмена считают по одной и той же функции
:func:`plan_cleanup`, поэтому числа в подтверждении и в отчёте совпадают.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from tutor_bot.domain.enums import LessonPaymentStatus, LessonStatus
from tutor_bot.domain.models import Lesson
from tutor_bot.storage.sqlite import SQLiteStorage

CANCELLABLE_STATUSES = {
    LessonStatus.PLANNED.value,
    LessonStatus.PENDING_CONFIRMATION.value,
}

SKIP_PAST = "прошедшее"
SKIP_STATUS = "статус не позволяет отмену"
SKIP_PAID = "оплачено"


@dataclass
class CleanupPlan:
    cancellable: list[Lesson] = field(default_factory=list)
    skipped: dict[str, int] = field(default_factory=dict)
    rules: int = 0

    @property
    def first_date(self) -> datetime | None:
        return self.cancellable[0].starts_at if self.cancellable else None

    @property
    def last_date(self) -> datetime | None:
        return self.cancellable[-1].starts_at if self.cancellable else None

    def as_payload(self) -> dict[str, object]:
        return {
            "rules": self.rules,
            "cancel_count": len(self.cancellable),
            "skipped_total": sum(self.skipped.values()),
            "skipped": [{"reason": reason, "count": count} for reason, count in sorted(self.skipped.items())],
            "first_date": self.first_date.isoformat() if self.first_date else None,
            "last_date": self.last_date.isoformat() if self.last_date else None,
        }


def plan_cleanup(db: SQLiteStorage, student_id: int, now: datetime) -> CleanupPlan:
    plan = CleanupPlan(rules=len(db.list_schedule_rules(student_id)))
    paid_lesson_ids = db.list_lesson_ids_with_payments(student_id)
    lessons = sorted(db.list_student_lessons(student_id, limit=10000), key=lambda item: item.starts_at)
    for lesson in lessons:
        if lesson.starts_at <= now:
            continue
        if lesson.status not in CANCELLABLE_STATUSES:
            # Отменённые и перенесённые молчаливо пропускаем: это не «пропуск
            # из-за оплаты», а просто нечего отменять. Повторный вызов
            # очистки благодаря этому идемпотентен.
            if lesson.status not in {
                LessonStatus.CANCELLED_BY_STUDENT.value,
                LessonStatus.CANCELLED_BY_TEACHER.value,
                LessonStatus.CANCELLED_BY_PARENT.value,
            }:
                plan.skipped[SKIP_STATUS] = plan.skipped.get(SKIP_STATUS, 0) + 1
            continue
        if lesson.id in paid_lesson_ids or lesson.payment_status == LessonPaymentStatus.CONFIRMED.value:
            plan.skipped[SKIP_PAID] = plan.skipped.get(SKIP_PAID, 0) + 1
            continue
        plan.cancellable.append(lesson)
    return plan


def apply_cleanup(db: SQLiteStorage, student_id: int, now: datetime, reason: str = "") -> CleanupPlan:
    plan = plan_cleanup(db, student_id, now)
    for lesson in plan.cancellable:
        lesson.status = LessonStatus.CANCELLED_BY_TEACHER.value
        lesson.cancelled_by = "tutor"
        lesson.cancellation_reason = reason or "очистка стабильного расписания"
        db.update_lesson(lesson)
    db.delete_schedule_rules_for_student(student_id)
    return plan
