from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    ADMIN = "admin"
    STUDENT = "student"
    PARENT = "parent"


class PrepType(StrEnum):
    EGE = "ЕГЭ"
    OGE = "ОГЭ"
    SCHOOL = "школьная успеваемость"
    PYTHON = "Python"
    OLYMPIAD = "олимпиадная подготовка"
    OTHER = "другое"


class StudentStatus(StrEnum):
    ACTIVE = "активен"
    PAUSED = "пауза"
    ARCHIVED = "архив"
    LEAD = "анкета"


class LessonStatus(StrEnum):
    PENDING_CONFIRMATION = "ожидает подтверждения"
    PLANNED = "запланировано"
    CONDUCTED = "проведено"
    CANCELLED_BY_STUDENT = "отменено учеником"
    CANCELLED_BY_TEACHER = "отменено преподавателем"
    CANCELLED_BY_PARENT = "отменено родителем"
    MOVED = "перенесено"


class LessonPaymentStatus(StrEnum):
    NOT_MARKED = "не отмечено"
    STUDENT_MARKED = "ученик отметил оплату"
    PARENT_MARKED = "родитель отметил оплату"
    CONFIRMED = "оплачено"
    UNPAID = "не оплачено"


class HomeworkStatus(StrEnum):
    ASSIGNED = "выдано"
    WAITING = "ожидание выполнения"
    SUBMITTED = "сдано"
    SUBMITTED_LATE = "сдано с опозданием"
    DONE = "выполнено"
    CHECKED = "проверено"
    NEEDS_FIX = "нужно исправить"
    OVERDUE = "просрочено"
    CANCELLED = "отменено"


class PaymentStatus(StrEnum):
    PENDING = "ожидает подтверждения"
    CONFIRMED = "подтверждено"
    REJECTED = "отклонено"


class BalanceMode(StrEnum):
    LESSONS = "lessons"
    MONEY = "money"


class PrepTopicStatus(StrEnum):
    NOT_STARTED = "не начинали"
    STARTED = "начали"
    DONE = "прошли"
    REVIEW = "нужно повторить"
    PROBLEM = "проблемная тема"
    CONFIDENT = "уверенно решает"


class PlanItemStatus(StrEnum):
    NOT_STARTED = "не начато"
    IN_PROGRESS = "в процессе"
    DONE = "выполнено"
    REVIEW = "нужно повторить"
