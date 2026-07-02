from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tutor_bot.domain.models import Lesson, StudentProfile
from tutor_bot.services.calendar import build_lesson_ics, calendar_filename


class CalendarTests(unittest.TestCase):
    def test_build_lesson_ics_contains_apple_calendar_event_fields(self) -> None:
        student = StudentProfile(
            id=3,
            full_name="Иван",
            prep_type="ЕГЭ",
            subject="Информатика",
            meeting_url="https://telemost.example",
            board_url="https://board.example",
        )
        lesson = Lesson(
            id=7,
            student_id=3,
            starts_at=datetime(2026, 6, 3, 18, 0),
            duration_minutes=90,
        )

        ics = build_lesson_ics(lesson, student, timezone="Europe/Moscow")

        self.assertIn("BEGIN:VCALENDAR", ics)
        self.assertIn("BEGIN:VEVENT", ics)
        self.assertIn("UID:lesson-7@tutor-bot", ics)
        self.assertIn("DTSTART;TZID=Europe/Moscow:20260603T180000", ics)
        self.assertIn("DTEND;TZID=Europe/Moscow:20260603T193000", ics)
        self.assertIn("SUMMARY:Занятие: Иван", ics)
        self.assertIn("Телемост: https://telemost.example", ics)

    def test_calendar_filename_is_ics(self) -> None:
        student = StudentProfile(id=3, full_name="Иван Иванов")
        lesson = Lesson(
            id=7,
            student_id=3,
            starts_at=datetime(2026, 6, 3, 18, 0),
            duration_minutes=90,
        )

        self.assertEqual(calendar_filename(lesson, student), "lesson_20260603_1800_Иван_Иванов.ics")


if __name__ == "__main__":
    unittest.main()
