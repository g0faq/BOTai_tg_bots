from __future__ import annotations

import sys
import unittest
from datetime import date, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tutor_bot.config import Settings
from tutor_bot.bot.handlers import (
    StickerSpamGuard,
    browser_invite_urls,
    format_url_list,
    infer_progress_goal,
    next_date_for_weekday,
    parse_knowledge_level,
    parse_progress,
    parse_regular_setup,
    recurring_time_options,
    stable_schedule_until,
    webapp_url_bases,
)
from tutor_bot.domain.models import StudentProfile
from tutor_bot.services.scheduling import WorkHours


class HandlerHelperTests(unittest.TestCase):
    def test_sticker_spam_guard_rate_limits_warnings(self) -> None:
        guard = StickerSpamGuard()
        kwargs = {
            "limit": 2,
            "window_seconds": 10,
            "block_seconds": 60,
            "warning_cooldown_seconds": 30,
        }

        self.assertTrue(guard.should_warn(123, now=100.0, **kwargs))
        self.assertFalse(guard.should_warn(123, now=101.0, **kwargs))
        self.assertFalse(guard.should_warn(123, now=102.0, **kwargs))
        self.assertFalse(guard.should_warn(123, now=150.0, **kwargs))
        self.assertTrue(guard.should_warn(123, now=163.0, **kwargs))

    def test_parse_progress_accepts_slash_or_space(self) -> None:
        self.assertEqual(parse_progress("2/15"), (2, 15))
        self.assertEqual(parse_progress("3 20"), (3, 20))

    def test_parse_progress_rejects_current_above_goal(self) -> None:
        with self.assertRaises(ValueError):
            parse_progress("16/15")

    def test_parse_knowledge_level_accepts_zero_to_ten(self) -> None:
        self.assertEqual(parse_knowledge_level("0"), 0)
        self.assertEqual(parse_knowledge_level("10"), 10)
        with self.assertRaises(ValueError):
            parse_knowledge_level("11")

    def test_infer_progress_goal_by_prep_and_subject(self) -> None:
        self.assertEqual(infer_progress_goal("ЕГЭ", "Информатика"), 27)
        self.assertEqual(infer_progress_goal("ЕГЭ", "Математика"), 19)
        self.assertEqual(infer_progress_goal("ОГЭ", "Информатика"), 19)
        self.assertEqual(infer_progress_goal("ОГЭ", "Математика"), 25)
        self.assertEqual(infer_progress_goal("Успеваемость", "Математика"), 0)

    def test_parse_regular_setup_accepts_different_times_by_day(self) -> None:
        slots, until, duration = parse_regular_setup(
            "1 18:00; 3 16:30; 6 11:00 31.08 90",
            today=date(2026, 6, 1),
            default_duration=60,
        )

        self.assertEqual(until, date(2026, 8, 31))
        self.assertEqual(duration, 90)
        self.assertEqual([(slot.weekdays, slot.lesson_time) for slot in slots], [
            ({1}, time(18, 0)),
            ({3}, time(16, 30)),
            ({6}, time(11, 0)),
        ])

    def test_parse_regular_setup_keeps_old_shared_time_format(self) -> None:
        slots, until, duration = parse_regular_setup(
            "1,4 18:00 31.08",
            today=date(2026, 6, 1),
            default_duration=60,
        )

        self.assertEqual(until, date(2026, 8, 31))
        self.assertEqual(duration, 60)
        self.assertEqual(len(slots), 1)
        self.assertEqual(slots[0].weekdays, {1, 4})
        self.assertEqual(slots[0].lesson_time, time(18, 0))

    def test_stable_schedule_until_uses_exam_date_or_year_ahead(self) -> None:
        today = date(2026, 6, 1)

        self.assertEqual(
            stable_schedule_until(StudentProfile(exam_date=date(2026, 8, 31)), today),
            date(2026, 8, 31),
        )
        self.assertEqual(stable_schedule_until(StudentProfile(), today), date(2027, 6, 1))

    def test_recurring_time_options_follow_work_hours_and_duration(self) -> None:
        work_hours = WorkHours(
            weekdays={1},
            starts_at=time(10, 0),
            ends_at=time(12, 0),
            slot_step_minutes=30,
        )

        self.assertEqual(next_date_for_weekday(date(2026, 6, 1), 3), date(2026, 6, 3))
        self.assertEqual(
            recurring_time_options(date(2026, 6, 1), 60, work_hours),
            [time(10, 0), time(10, 30), time(11, 0)],
        )

    def test_webapp_url_bases_keep_primary_first_and_deduplicate(self) -> None:
        settings = Settings(
            bot_token="123:test",
            admin_telegram_ids=[1],
            teacher_chat_url="",
            database_path=":memory:",
            timezone="Europe/Moscow",
            default_lesson_price=2000,
            default_lesson_duration_minutes=60,
            default_payment_package_size=4,
            low_balance_threshold=1,
            reminder_minutes_before_lesson=5,
            working_days=[1, 2, 3, 4, 5, 6],
            working_start=time(10, 0),
            working_end=time(22, 0),
            slot_step_minutes=30,
            webapp_url="https://g0faqtutorbot.ru/",
            webapp_url_aliases=[
                "https://www.g0faqtutorbot.ru",
                "https://5-42-109-83.sslip.io",
                "https://folder-leader.trycloudflare.com",
                "https://g0faqtutorbot.ru",
            ],
        )

        self.assertEqual(
            webapp_url_bases(settings),
            [
                "https://g0faqtutorbot.ru",
                "https://www.g0faqtutorbot.ru",
                "https://5-42-109-83.sslip.io",
                "https://folder-leader.trycloudflare.com",
            ],
        )
        self.assertEqual(
            browser_invite_urls(settings, "token", tutor=True),
            [
                "https://folder-leader.trycloudflare.com/login/tutor/token",
                "https://g0faqtutorbot.ru/login/tutor/token",
                "https://www.g0faqtutorbot.ru/login/tutor/token",
                "https://5-42-109-83.sslip.io/login/tutor/token",
            ],
        )
        self.assertEqual(
            format_url_list(["https://g0faqtutorbot.ru", "https://www.g0faqtutorbot.ru"]),
            "1. https://g0faqtutorbot.ru\n2. https://www.g0faqtutorbot.ru",
        )


if __name__ == "__main__":
    unittest.main()
