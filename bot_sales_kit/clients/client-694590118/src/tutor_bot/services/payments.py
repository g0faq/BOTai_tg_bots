from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from tutor_bot.domain.enums import BalanceMode, LessonStatus, PaymentStatus
from tutor_bot.domain.models import Lesson, Payment, StudentProfile


class PaymentStorage(Protocol):
    def get_student(self, student_id: int) -> StudentProfile | None: ...

    def update_student(self, profile: StudentProfile) -> None: ...

    def get_lesson(self, lesson_id: int) -> Lesson | None: ...

    def update_lesson(self, lesson: Lesson) -> None: ...

    def get_payment(self, payment_id: int) -> Payment | None: ...

    def update_payment(self, payment: Payment) -> None: ...

    def list_debtors(self) -> list[StudentProfile]: ...


@dataclass(frozen=True, slots=True)
class ChargeResult:
    student: StudentProfile
    lesson: Lesson
    charged_amount: int
    charged_lessons: int
    needs_payment: bool
    low_balance: bool


def confirm_payment(storage: PaymentStorage, payment_id: int) -> Payment:
    payment = storage.get_payment(payment_id)
    if payment is None:
        raise ValueError("payment not found")
    student = storage.get_student(payment.student_id)
    if student is None:
        raise ValueError("student not found")
    if payment.status == PaymentStatus.CONFIRMED.value:
        return payment
    if payment.status == PaymentStatus.REJECTED.value:
        raise ValueError("rejected payment cannot be confirmed")

    if student.balance_mode == BalanceMode.LESSONS.value:
        lessons_to_add = payment.lessons_count
        base_price = student.price_60 or student.lesson_price
        if lessons_to_add <= 0 and base_price > 0:
            lessons_to_add = payment.amount // base_price
        student.balance_lessons += lessons_to_add
    else:
        student.balance_money += payment.amount

    payment.status = PaymentStatus.CONFIRMED.value
    payment.confirmed_at = datetime.now(UTC)
    payment.balance_after_lessons = student.balance_lessons
    payment.balance_after_money = student.balance_money

    storage.update_student(student)
    storage.update_payment(payment)
    return payment


def reject_payment(storage: PaymentStorage, payment_id: int, comment: str = "") -> Payment:
    payment = storage.get_payment(payment_id)
    if payment is None:
        raise ValueError("payment not found")
    if payment.status == PaymentStatus.CONFIRMED.value:
        raise ValueError("confirmed payment cannot be rejected")
    payment.status = PaymentStatus.REJECTED.value
    payment.comment = comment
    storage.update_payment(payment)
    return payment


def calculate_lesson_cost(student: StudentProfile, lesson: Lesson) -> int:
    if lesson.duration_minutes == 60:
        return student.price_60 or student.lesson_price
    if lesson.duration_minutes == 90:
        return student.price_90 or round((student.price_60 or student.lesson_price) * 1.5)
    if lesson.duration_minutes == 120:
        return student.price_120 or (student.price_60 or student.lesson_price) * 2
    return round((student.price_60 or student.lesson_price) * lesson.duration_minutes / 60)


def mark_lesson_conducted(
    storage: PaymentStorage,
    lesson_id: int,
    topic: str = "",
    next_plan: str = "",
    low_balance_threshold: int = 1,
) -> ChargeResult:
    lesson = storage.get_lesson(lesson_id)
    if lesson is None:
        raise ValueError("lesson not found")
    if lesson.status in {
        LessonStatus.CANCELLED_BY_PARENT.value,
        LessonStatus.CANCELLED_BY_STUDENT.value,
        LessonStatus.CANCELLED_BY_TEACHER.value,
    }:
        raise ValueError("cancelled lesson cannot be conducted")
    student = storage.get_student(lesson.student_id)
    if student is None:
        raise ValueError("student not found")

    charged_lessons = 0
    charged_amount = 0
    lesson.status = LessonStatus.CONDUCTED.value
    if topic:
        lesson.topic = topic
    if next_plan:
        lesson.next_plan = next_plan

    if not lesson.charged:
        if student.balance_mode == BalanceMode.LESSONS.value:
            student.balance_lessons -= 1
            charged_lessons = 1
        else:
            charged_amount = calculate_lesson_cost(student, lesson)
            student.balance_money -= charged_amount
        lesson.charged = True
        storage.update_student(student)

    storage.update_lesson(lesson)
    return ChargeResult(
        student=student,
        lesson=lesson,
        charged_amount=charged_amount,
        charged_lessons=charged_lessons,
        needs_payment=is_debtor(student),
        low_balance=is_low_balance(student, low_balance_threshold),
    )


def is_debtor(student: StudentProfile) -> bool:
    if student.balance_mode == BalanceMode.LESSONS.value:
        return student.balance_lessons < 0
    return student.balance_money < 0


def is_low_balance(student: StudentProfile, threshold: int) -> bool:
    if student.balance_mode == BalanceMode.LESSONS.value:
        return 0 < student.balance_lessons <= threshold
    return False
