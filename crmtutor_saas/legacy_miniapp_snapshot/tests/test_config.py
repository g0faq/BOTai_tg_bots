from __future__ import annotations

import sys
import unittest
from datetime import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tutor_bot.config import Settings


class ConfigTests(unittest.TestCase):
    def test_settings_local_now_returns_naive_local_datetime(self) -> None:
        settings = Settings(
            bot_token="token",
            admin_telegram_ids=[1],
            teacher_chat_url="",
            database_path=":memory:",
            timezone="Europe/Moscow",
            default_lesson_price=1500,
            default_lesson_duration_minutes=90,
            default_payment_package_size=4,
            low_balance_threshold=1,
            reminder_minutes_before_lesson=5,
            working_days=[1, 2, 3, 4, 5, 6],
            working_start=time(10, 0),
            working_end=time(21, 0),
            slot_step_minutes=30,
        )

        now = settings.local_now()

        self.assertIsNone(now.tzinfo)
        self.assertEqual(settings.local_today(), now.date())


if __name__ == "__main__":
    unittest.main()
