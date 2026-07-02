from __future__ import annotations

import sys
import unittest
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tutor_bot.bot.formatters import (
    format_lesson_price_for_duration,
    format_prices,
    format_student_card,
    lesson_line,
    lesson_public_line,
    student_line,
)
from tutor_bot.domain.models import Lesson, StudentProfile
from tutor_bot.services.timezones import normalize_timezone, timezone_label


class FormatterTests(unittest.TestCase):
    def test_empty_prices_are_displayed_as_dash(self) -> None:
        student = StudentProfile(full_name="Иван")

        self.assertEqual(format_lesson_price_for_duration(student, 60), "-")
        self.assertEqual(format_prices(student), "60 мин: -; 90 мин: -; 120 мин: -")

    def test_admin_student_card_returns_text(self) -> None:
        student = StudentProfile(
            id=1,
            full_name="Иван",
            grade="10",
            subject="Информатика",
            prep_type="ЕГЭ",
            goal="90+",
            start_date=date(2026, 5, 12),
            progress_goal=27,
        )

        text = format_student_card(student, lessons=[], homework=None, topics=[], plan=[])

        self.assertIn("Карточка ученика #1", text)
        self.assertIn("Начало сотрудничества: 12 мая", text)
        self.assertNotIn("Чат ученика", text)
        self.assertNotIn("Баланс:", text)
        self.assertNotIn("Долг по оплате", text)
        self.assertIn("Прогресс: 0% (0/27)", text)

    def test_admin_student_card_shows_no_payment_debt_when_balance_positive(self) -> None:
        student = StudentProfile(full_name="Иван", balance_lessons=2, progress_current=3, progress_goal=10)

        text = format_student_card(student, lessons=[], homework=None, topics=[], plan=[])

        self.assertNotIn("Долг по оплате", text)
        self.assertIn("Прогресс: 30% (3/10)", text)

    def test_admin_student_card_hides_progress_when_goal_is_zero(self) -> None:
        student = StudentProfile(full_name="Иван", prep_type="Успеваемость", progress_goal=0)

        text = format_student_card(student, lessons=[], homework=None, topics=[], plan=[])

        self.assertNotIn("Прогресс:", text)

    def test_student_line_does_not_show_lesson_balance(self) -> None:
        student = StudentProfile(
            id=3,
            full_name="Иван",
            prep_type="ЕГЭ",
            balance_lessons=0,
            student_telegram="@ivan",
        )

        text = student_line(student)

        self.assertIn("#3 Иван | ЕГЭ", text)
        self.assertNotIn("осталось", text)
        self.assertNotIn("баланс", text)

    def test_lesson_public_line_shows_student_timezone_first(self) -> None:
        student = StudentProfile(full_name="Иван", timezone="Asia/Yekaterinburg")
        lesson = Lesson(student_id=1, starts_at=datetime(2026, 6, 3, 18, 0), duration_minutes=60)

        text = lesson_public_line(lesson, student, teacher_timezone="Europe/Moscow")

        self.assertIn("20:00 (3 июня, Екб)", text)
        self.assertIn("18:00 (3 июня, МСК+0)", text)

    def test_lesson_line_shows_teacher_timezone_first(self) -> None:
        student = StudentProfile(full_name="Иван", timezone="Asia/Yekaterinburg")
        lesson = Lesson(id=7, student_id=1, starts_at=datetime(2026, 6, 3, 18, 0), duration_minutes=60)

        text = lesson_line(lesson, student, teacher_timezone="Europe/Moscow")

        self.assertIn("#7 18:00 (3 июня, МСК+0)", text)
        self.assertIn("у ученика 20:00 (3 июня, Екб)", text)

    def test_msk_offset_timezone_format_is_supported(self) -> None:
        self.assertEqual(normalize_timezone("МСК+0"), "Europe/Moscow")
        self.assertEqual(normalize_timezone("МСК+3"), "Etc/GMT-6")
        self.assertEqual(normalize_timezone("мск-1"), "Etc/GMT-2")
        self.assertEqual(timezone_label("Europe/Moscow"), "МСК+0")
        self.assertEqual(timezone_label("Etc/GMT-6"), "МСК+3")
        self.assertEqual(timezone_label("Etc/GMT-2"), "МСК-1")


if __name__ == "__main__":
    unittest.main()
