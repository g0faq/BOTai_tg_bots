from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tutor_bot.domain.enums import BalanceMode, LessonStatus
from tutor_bot.domain.models import Lesson, StudentProfile
from tutor_bot.services.google_sheets import build_stats_values, collect_lesson_rows
from tutor_bot.storage.sqlite import SQLiteStorage


class GoogleSheetsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.storage = SQLiteStorage(Path(self.tempdir.name) / "test.sqlite3")

    def tearDown(self) -> None:
        self.storage.close()
        self.tempdir.cleanup()

    def test_collect_lesson_rows_uses_conducted_lessons_only(self) -> None:
        student = self.storage.add_student(
            StudentProfile(
                full_name="Маша",
                subject="математика",
                lesson_price=1800,
                price_60=1800,
                price_90=2700,
                balance_mode=BalanceMode.LESSONS.value,
            )
        )
        self.storage.add_lesson(
            Lesson(
                student_id=student.id,
                starts_at=datetime(2026, 5, 12, 18, 0),
                duration_minutes=90,
                status=LessonStatus.CONDUCTED.value,
                topic="Производная",
            )
        )
        self.storage.add_lesson(
            Lesson(
                student_id=student.id,
                starts_at=datetime(2026, 5, 13, 18, 0),
                duration_minutes=60,
                status=LessonStatus.PLANNED.value,
            )
        )

        rows = collect_lesson_rows(self.storage)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].student_name, "Маша")
        self.assertEqual(rows[0].subject, "математика")
        self.assertEqual(rows[0].work_hours, 1.5)
        self.assertEqual(rows[0].salary_amount, 2700)

    def test_build_stats_values_summarizes_salary_and_work_hours(self) -> None:
        student = self.storage.add_student(
            StudentProfile(
                full_name="Даня",
                subject="информатика",
                lesson_price=1500,
                price_60=1500,
                price_120=3000,
            )
        )
        self.storage.add_lesson(
            Lesson(
                student_id=student.id,
                starts_at=datetime(2026, 6, 1, 10, 0),
                duration_minutes=60,
                status=LessonStatus.CONDUCTED.value,
            )
        )
        self.storage.add_lesson(
            Lesson(
                student_id=student.id,
                starts_at=datetime(2026, 6, 2, 10, 0),
                duration_minutes=120,
                status=LessonStatus.CONDUCTED.value,
            )
        )

        stats = build_stats_values(collect_lesson_rows(self.storage))

        self.assertIn(["Проведено уроков", 2], stats)
        self.assertIn(["Рабочие часы", 3.0], stats)
        self.assertIn(["Зарплата", 4500], stats)
        self.assertIn(["2026-06", 2, 3.0, 4500], stats)
        self.assertIn(["Даня", 2, 3.0, 4500], stats)


if __name__ == "__main__":
    unittest.main()
