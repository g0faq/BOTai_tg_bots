from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tutor_bot.domain.enums import HomeworkStatus, LessonPaymentStatus, LessonStatus
from tutor_bot.domain.models import Homework, Lesson, StudentProfile
from tutor_bot.storage.sqlite import SQLiteStorage


class IdempotencyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.storage = SQLiteStorage(Path(self.tempdir.name) / "test.sqlite3")

    def tearDown(self) -> None:
        self.storage.close()
        self.tempdir.cleanup()

    def test_duplicate_student_identity_reuses_existing_profile(self) -> None:
        first = self.storage.add_student(
            StudentProfile(
                full_name="Иван Петров",
                grade="10",
                subject="Информатика",
                student_telegram="@ivan",
            )
        )
        second = self.storage.add_student(
            StudentProfile(
                full_name="Иван Петров",
                grade="10",
                subject="Информатика",
                student_telegram="@ivan",
            )
        )

        self.assertEqual(second.id, first.id)
        self.assertEqual(len(self.storage.list_students()), 1)

    def test_duplicate_lesson_reuses_existing_record(self) -> None:
        student = self.storage.add_student(StudentProfile(full_name="Маша"))
        first = self.storage.add_lesson(
            Lesson(
                student_id=student.id,
                starts_at=datetime(2026, 6, 5, 18, 0),
                duration_minutes=60,
                status=LessonStatus.PENDING_CONFIRMATION.value,
                payment_status=LessonPaymentStatus.NOT_MARKED.value,
            )
        )
        second = self.storage.add_lesson(
            Lesson(
                student_id=student.id,
                starts_at=datetime(2026, 6, 5, 18, 0),
                duration_minutes=60,
                status=LessonStatus.PENDING_CONFIRMATION.value,
                payment_status=LessonPaymentStatus.NOT_MARKED.value,
            )
        )

        self.assertEqual(second.id, first.id)
        self.assertEqual(len(self.storage.list_student_lessons(student.id)), 1)

    def test_duplicate_lesson_slot_reuses_existing_record_with_different_status(self) -> None:
        student = self.storage.add_student(StudentProfile(full_name="Маша"))
        first = self.storage.add_lesson(
            Lesson(
                student_id=student.id,
                starts_at=datetime(2026, 6, 5, 18, 0),
                duration_minutes=60,
                status=LessonStatus.PLANNED.value,
            )
        )
        second = self.storage.add_lesson(
            Lesson(
                student_id=student.id,
                starts_at=datetime(2026, 6, 5, 18, 0),
                duration_minutes=60,
                status=LessonStatus.PENDING_CONFIRMATION.value,
            )
        )

        self.assertEqual(second.id, first.id)
        self.assertEqual(len(self.storage.list_student_lessons(student.id)), 1)

    def test_recent_duplicate_homework_reuses_existing_record(self) -> None:
        student = self.storage.add_student(StudentProfile(full_name="Аня"))
        first = self.storage.add_homework(
            Homework(
                student_id=student.id,
                title="Вариант 1",
                text="Решить задачи 1-5",
                status=HomeworkStatus.WAITING.value,
                links=["https://example.com/task"],
            )
        )
        second = self.storage.add_homework(
            Homework(
                student_id=student.id,
                title="Вариант 1",
                text="Решить задачи 1-5",
                status=HomeworkStatus.WAITING.value,
                links=["https://example.com/task"],
            )
        )

        self.assertEqual(second.id, first.id)
        self.assertEqual(len(self.storage.list_homeworks(student.id)), 1)


if __name__ == "__main__":
    unittest.main()
