from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
from datetime import datetime, time, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tutor_bot import main as bot_main
from tutor_bot.config import Settings
from tutor_bot.domain.enums import LessonStatus
from tutor_bot.domain.models import Lesson, StudentProfile, UserAccount
from tutor_bot.storage.sqlite import SQLiteStorage

ADMIN_ID = 1023669797
STUDENT_TG_ID = 555000111


class _StopLoop(Exception):
    """Sentinel used to break out of the infinite reminder loop in tests."""


class FakeBot:
    def __init__(self, fail_for: set[int] | None = None) -> None:
        self.sent: list[tuple[int, str]] = []
        self.fail_for = fail_for or set()

    async def send_message(self, chat_id: int, text: str) -> None:
        if chat_id in self.fail_for:
            raise RuntimeError(f"telegram rejected chat {chat_id}")
        self.sent.append((chat_id, text))

    def texts_for(self, chat_id: int) -> list[str]:
        return [text for target, text in self.sent if target == chat_id]


def build_settings(database_path: str, timezone: str = "Europe/Moscow") -> Settings:
    return Settings(
        bot_token="test-token",
        admin_telegram_ids=[ADMIN_ID],
        teacher_chat_url="",
        database_path=database_path,
        timezone=timezone,
        default_lesson_price=1500,
        default_lesson_duration_minutes=60,
        default_payment_package_size=4,
        low_balance_threshold=1,
        reminder_minutes_before_lesson=5,
        working_days=[1, 2, 3, 4, 5, 6, 7],
        working_start=time(7, 0),
        working_end=time(23, 0),
        slot_step_minutes=30,
    )


class ReminderLoopTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "test.sqlite3"
        self.storage = SQLiteStorage(self.db_path)
        self.settings = build_settings(str(self.db_path))
        self.student = self.storage.add_student(
            StudentProfile(full_name="Михаил Иванов", grade="11", subject="Информатика")
        )

    def tearDown(self) -> None:
        self.storage.close()
        self.tempdir.cleanup()

    def add_lesson(self, starts_at: datetime, duration_minutes: int = 60) -> Lesson:
        return self.storage.add_lesson(
            Lesson(
                student_id=self.student.id,
                starts_at=starts_at,
                duration_minutes=duration_minutes,
                status=LessonStatus.PLANNED.value,
            )
        )

    def link_student_account(self) -> None:
        self.storage.upsert_user(
            UserAccount(telegram_id=STUDENT_TG_ID, role="student", student_id=self.student.id)
        )

    def run_loop(self, bot: FakeBot, clock: list[datetime]) -> None:
        """Run reminder_loop over a fixed sequence of "now" values, then stop."""
        ticks = list(clock)

        def fake_now(_self: Settings) -> datetime:
            return ticks[0] if len(ticks) == 1 else ticks.pop(0)

        async def fake_sleep(_seconds: float) -> None:
            if not ticks or len(ticks) == 1:
                raise _StopLoop
            return None

        async def runner() -> None:
            with patch.object(Settings, "local_now", fake_now):
                with patch.object(asyncio, "sleep", fake_sleep):
                    try:
                        await bot_main.reminder_loop(bot, self.storage, self.settings)
                    except _StopLoop:
                        pass

        asyncio.run(runner())

    # 1. базовый сценарий
    def test_admin_reminder_is_sent_for_lesson_in_five_minutes(self) -> None:
        starts_at = datetime(2026, 8, 6, 10, 0, 0)
        self.add_lesson(starts_at)
        bot = FakeBot()

        self.run_loop(bot, [datetime(2026, 8, 6, 9, 55, 0), datetime(2026, 8, 6, 9, 56, 0)])

        admin_messages = bot.texts_for(ADMIN_ID)
        self.assertEqual(len(admin_messages), 1, "админ должен получить ровно одно напоминание")
        self.assertIn("Напоминание о занятии", admin_messages[0])
        self.assertIn("Михаил Иванов", admin_messages[0])

    # 2. окно выборки против интервала сна цикла
    def test_reminder_is_not_skipped_when_tick_is_slower_than_window(self) -> None:
        starts_at = datetime(2026, 8, 6, 10, 0, 0)
        self.add_lesson(starts_at)
        bot = FakeBot()
        # цикл «просыпается» раз в 5 минут вместо 60 секунд: окно 70 секунд
        # такой шаг перепрыгнул бы, если бы выборка зависела только от starts_at
        ticks = [datetime(2026, 8, 6, 9, 40, 0) + timedelta(minutes=5 * i) for i in range(8)]
        self.run_loop(bot, ticks)

        self.assertEqual(
            len(bot.texts_for(ADMIN_ID)), 1, "редкий тик не должен терять напоминание"
        )

    # 3. таймзона, отличная от UTC и от московской
    def test_reminder_respects_non_utc_timezone(self) -> None:
        self.settings = build_settings(str(self.db_path), timezone="Asia/Yekaterinburg")
        starts_at = datetime(2026, 8, 6, 18, 0, 0)
        self.add_lesson(starts_at)
        bot = FakeBot()

        self.run_loop(bot, [datetime(2026, 8, 6, 17, 55, 0), datetime(2026, 8, 6, 17, 56, 0)])

        admin_messages = bot.texts_for(ADMIN_ID)
        self.assertEqual(len(admin_messages), 1)
        self.assertIn("18:00", admin_messages[0])

    # 4. идемпотентность
    def test_repeated_iterations_do_not_duplicate_reminder(self) -> None:
        starts_at = datetime(2026, 8, 6, 10, 0, 0)
        lesson = self.add_lesson(starts_at)
        bot = FakeBot()

        ticks = [datetime(2026, 8, 6, 9, 55, 0) + timedelta(seconds=60 * i) for i in range(5)]
        self.run_loop(bot, ticks)

        self.assertEqual(len(bot.texts_for(ADMIN_ID)), 1)
        stored = self.storage.get_lesson(lesson.id)
        self.assertIsNotNone(stored.reminder_sent_at, "флаг отправки должен быть выставлен")

    # 5. исключение внутри итерации не должно убивать цикл
    def test_iteration_error_does_not_kill_the_loop(self) -> None:
        self.add_lesson(datetime(2026, 8, 6, 10, 0, 0))
        bot = FakeBot()

        real_list = self.storage.list_lessons_between
        calls = {"n": 0}

        def flaky_list(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("database is locked")
            return real_list(*args, **kwargs)

        with patch.object(self.storage, "list_lessons_between", flaky_list):
            ticks = [datetime(2026, 8, 6, 9, 55, 0) + timedelta(seconds=60 * i) for i in range(4)]
            self.run_loop(bot, ticks)

        self.assertEqual(
            len(bot.texts_for(ADMIN_ID)),
            1,
            "после сбоя в одной итерации цикл обязан продолжить работу",
        )

    # 6. адресат — админ, даже если у ученика нет привязанного аккаунта
    def test_admin_gets_reminder_even_without_student_account(self) -> None:
        self.add_lesson(datetime(2026, 8, 6, 10, 0, 0))
        bot = FakeBot()

        self.run_loop(bot, [datetime(2026, 8, 6, 9, 55, 0), datetime(2026, 8, 6, 9, 56, 0)])

        self.assertEqual(len(bot.texts_for(ADMIN_ID)), 1)
        self.assertEqual(bot.texts_for(STUDENT_TG_ID), [])

    def test_student_and_admin_get_separate_texts(self) -> None:
        self.link_student_account()
        self.add_lesson(datetime(2026, 8, 6, 10, 0, 0))
        bot = FakeBot()

        self.run_loop(bot, [datetime(2026, 8, 6, 9, 55, 0), datetime(2026, 8, 6, 9, 56, 0)])

        self.assertIn("Напоминание о занятии", bot.texts_for(ADMIN_ID)[0])
        self.assertIn("Скоро занятие", bot.texts_for(STUDENT_TG_ID)[0])

    # 7. провал доставки админу не должен «съедать» напоминание навсегда
    def test_failed_admin_delivery_does_not_mark_reminder_as_sent(self) -> None:
        lesson = self.add_lesson(datetime(2026, 8, 6, 10, 0, 0))
        bot = FakeBot(fail_for={ADMIN_ID})

        self.run_loop(bot, [datetime(2026, 8, 6, 9, 55, 0), datetime(2026, 8, 6, 9, 56, 0)])

        stored = self.storage.get_lesson(lesson.id)
        self.assertIsNone(
            stored.reminder_sent_at,
            "если ни один адресат не получил напоминание, флаг ставить нельзя — "
            "иначе занятие навсегда выпадает из выборки",
        )


if __name__ == "__main__":
    unittest.main()
