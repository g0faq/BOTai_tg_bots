from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tutor_bot.domain.enums import BalanceMode, LessonStatus, Role
from tutor_bot.domain.models import Lesson, Payment, StudentProfile
from tutor_bot.services.payments import confirm_payment, mark_lesson_conducted
from tutor_bot.services.scheduling import cancel_lesson
from tutor_bot.storage.sqlite import SQLiteStorage


class PaymentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.storage = SQLiteStorage(Path(self.tempdir.name) / "test.sqlite3")

    def tearDown(self) -> None:
        self.storage.close()
        self.tempdir.cleanup()

    def test_confirm_payment_adds_lessons_and_conducted_lesson_charges_once(self) -> None:
        student = self.storage.add_student(
            StudentProfile(
                full_name="Маша",
                lesson_price=1800,
                price_60=1800,
                price_90=2700,
                price_120=3600,
                lesson_duration_minutes=60,
                balance_mode=BalanceMode.LESSONS.value,
            )
        )
        payment = self.storage.add_payment(
            Payment(student_id=student.id, amount=7200, lessons_count=4, sender_role=Role.PARENT.value)
        )
        lesson = self.storage.add_lesson(
            Lesson(student_id=student.id, starts_at=datetime(2026, 5, 12, 18, 0), duration_minutes=90)
        )

        confirm_payment(self.storage, payment.id)
        first_charge = mark_lesson_conducted(self.storage, lesson.id, topic="Задание 13")
        second_charge = mark_lesson_conducted(self.storage, lesson.id, topic="Задание 13")

        updated_student = self.storage.get_student(student.id)
        updated_lesson = self.storage.get_lesson(lesson.id)
        self.assertEqual(updated_student.balance_lessons, 3)
        self.assertEqual(first_charge.charged_lessons, 1)
        self.assertEqual(second_charge.charged_lessons, 0)
        self.assertTrue(updated_lesson.charged)
        self.assertEqual(updated_lesson.status, LessonStatus.CONDUCTED.value)

    def test_money_balance_charges_proportionally_to_duration(self) -> None:
        student = self.storage.add_student(
            StudentProfile(
                full_name="Даня",
                lesson_price=1800,
                price_60=1800,
                price_90=2700,
                price_120=3300,
                lesson_duration_minutes=60,
                balance_mode=BalanceMode.MONEY.value,
            )
        )
        payment = self.storage.add_payment(
            Payment(student_id=student.id, amount=7200, lessons_count=0, sender_role=Role.PARENT.value)
        )
        lesson = self.storage.add_lesson(
            Lesson(student_id=student.id, starts_at=datetime(2026, 5, 12, 18, 0), duration_minutes=60)
        )

        confirm_payment(self.storage, payment.id)
        charge = mark_lesson_conducted(self.storage, lesson.id)

        updated_student = self.storage.get_student(student.id)
        self.assertEqual(charge.charged_amount, 1800)
        self.assertEqual(updated_student.balance_money, 5400)

    def test_money_balance_uses_custom_price_for_90_minutes(self) -> None:
        student = self.storage.add_student(
            StudentProfile(
                full_name="Семен",
                lesson_price=1500,
                price_60=1500,
                price_90=2100,
                price_120=2800,
                balance_mode=BalanceMode.MONEY.value,
            )
        )
        payment = self.storage.add_payment(
            Payment(student_id=student.id, amount=5000, lessons_count=0, sender_role=Role.PARENT.value)
        )
        lesson = self.storage.add_lesson(
            Lesson(student_id=student.id, starts_at=datetime(2026, 5, 12, 18, 0), duration_minutes=90)
        )

        confirm_payment(self.storage, payment.id)
        charge = mark_lesson_conducted(self.storage, lesson.id)

        updated_student = self.storage.get_student(student.id)
        self.assertEqual(charge.charged_amount, 2100)
        self.assertEqual(updated_student.balance_money, 2900)

    def test_cancelled_lesson_cannot_be_charged(self) -> None:
        student = self.storage.add_student(
            StudentProfile(full_name="Иван", lesson_price=1800, balance_lessons=1)
        )
        lesson = self.storage.add_lesson(
            Lesson(student_id=student.id, starts_at=datetime(2026, 5, 12, 18, 0), duration_minutes=90)
        )
        cancel_lesson(self.storage, lesson.id, Role.ADMIN.value)

        with self.assertRaises(ValueError):
            mark_lesson_conducted(self.storage, lesson.id)

        self.assertEqual(self.storage.get_student(student.id).balance_lessons, 1)


if __name__ == "__main__":
    unittest.main()
