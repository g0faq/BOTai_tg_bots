from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    PLATFORM_ADMIN = "platform_admin"
    TUTOR = "tutor"
    TEACHER = "teacher"
    STUDENT = "student"
    PARENT = "parent"


class FinanceOperationType(StrEnum):
    MANUAL_PAYMENT = "manual_payment"
    PREPAYMENT = "prepayment"
    AUTO_LESSON_CHARGE = "auto_lesson_charge"
    REFUND = "refund"
    ADJUSTMENT = "adjustment"


class LessonStatus(StrEnum):
    PLANNED = "planned"
    PENDING_CONFIRMATION = "pending_confirmation"
    CONDUCTED = "conducted"
    CANCELLED = "cancelled"


class HomeworkStatus(StrEnum):
    ASSIGNED = "assigned"
    SUBMITTED = "submitted"
    NEEDS_FIX = "needs_fix"
    CHECKED = "checked"
