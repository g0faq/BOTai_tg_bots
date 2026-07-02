from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import date, datetime, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tutor_bot.domain.enums import LessonStatus, Role
from tutor_bot.domain.models import ClosedSlot, Lesson, PrepTopic, StudentProfile, UserAccount
from tutor_bot.services.scheduling import (
    RecurringLessonSlot,
    SlotUnavailableError,
    WorkHours,
    add_single_lesson,
    available_slots,
    cancel_lesson,
    clear_future_stable_lessons,
    create_recurring_lessons,
    create_recurring_lessons_for_slots,
    move_lesson,
)
from tutor_bot.storage.sqlite import SQLiteStorage


class SchedulingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.storage = SQLiteStorage(Path(self.tempdir.name) / "test.sqlite3")
        self.student = self.storage.add_student(
            StudentProfile(
                full_name="Иван",
                lesson_price=1800,
                lesson_duration_minutes=90,
                progress_current=2,
                progress_goal=15,
            )
        )
        self.work_hours = WorkHours(
            weekdays={1, 2, 3, 4, 5, 6, 7},
            starts_at=time(10, 0),
            ends_at=time(21, 0),
            slot_step_minutes=30,
        )

    def tearDown(self) -> None:
        self.storage.close()
        self.tempdir.cleanup()

    def test_single_lesson_rejects_busy_slot(self) -> None:
        self.storage.add_lesson(
            Lesson(
                student_id=self.student.id,
                starts_at=datetime(2026, 5, 12, 18, 0),
                duration_minutes=90,
            )
        )

        with self.assertRaises(SlotUnavailableError):
            add_single_lesson(
                self.storage,
                self.student.id,
                datetime(2026, 5, 12, 18, 30),
                60,
                self.work_hours,
            )

    def test_student_timezone_is_saved(self) -> None:
        student = self.storage.add_student(
            StudentProfile(full_name="Анна", timezone="Asia/Yekaterinburg")
        )

        saved = self.storage.get_student(student.id)

        self.assertEqual(saved.timezone, "Asia/Yekaterinburg")

    def test_recurring_schedule_skips_busy_and_closed_slots(self) -> None:
        self.storage.add_lesson(
            Lesson(
                student_id=self.student.id,
                starts_at=datetime(2026, 5, 12, 18, 0),
                duration_minutes=90,
            )
        )
        self.storage.add_closed_slot(
            ClosedSlot(
                starts_at=datetime(2026, 5, 14, 18, 0),
                ends_at=datetime(2026, 5, 14, 20, 0),
                reason="личные дела",
            )
        )

        result = create_recurring_lessons(
            storage=self.storage,
            student_id=self.student.id,
            from_date=date(2026, 5, 12),
            until=date(2026, 5, 21),
            weekdays={2, 4},
            lesson_time=time(18, 0),
            duration_minutes=90,
            work_hours=self.work_hours,
        )

        self.assertEqual(len(result.created), 2)
        self.assertEqual(len(result.skipped), 2)

    def test_recurring_schedule_can_use_different_times_by_day(self) -> None:
        result = create_recurring_lessons_for_slots(
            storage=self.storage,
            student_id=self.student.id,
            from_date=date(2026, 6, 1),
            until=date(2026, 6, 7),
            slots=[
                RecurringLessonSlot(weekdays={1}, lesson_time=time(18, 0)),
                RecurringLessonSlot(weekdays={3}, lesson_time=time(16, 30)),
                RecurringLessonSlot(weekdays={6}, lesson_time=time(11, 0)),
            ],
            duration_minutes=90,
            work_hours=self.work_hours,
        )

        self.assertEqual(
            [lesson.starts_at for lesson in result.created],
            [
                datetime(2026, 6, 1, 18, 0),
                datetime(2026, 6, 3, 16, 30),
                datetime(2026, 6, 6, 11, 0),
            ],
        )
        self.assertEqual(len({lesson.stable_series_id for lesson in result.created}), 1)

    def test_clear_future_stable_lessons_keeps_single_and_past_lessons(self) -> None:
        past_stable = self.storage.add_lesson(
            Lesson(
                student_id=self.student.id,
                starts_at=datetime(2026, 5, 25, 18, 0),
                duration_minutes=90,
                stable_series_id="stable",
            )
        )
        future_single = self.storage.add_lesson(
            Lesson(
                student_id=self.student.id,
                starts_at=datetime(2026, 6, 8, 18, 0),
                duration_minutes=90,
            )
        )
        future_stable = self.storage.add_lesson(
            Lesson(
                student_id=self.student.id,
                starts_at=datetime(2026, 6, 9, 18, 0),
                duration_minutes=90,
                stable_series_id="stable",
            )
        )

        cleared = clear_future_stable_lessons(
            self.storage,
            self.student.id,
            datetime(2026, 6, 1, 12, 0),
            Role.STUDENT.value,
        )

        self.assertEqual(cleared, 1)
        self.assertEqual(self.storage.get_lesson(past_stable.id).status, LessonStatus.PLANNED.value)
        self.assertEqual(self.storage.get_lesson(future_single.id).status, LessonStatus.PLANNED.value)
        self.assertEqual(
            self.storage.get_lesson(future_stable.id).status,
            LessonStatus.CANCELLED_BY_STUDENT.value,
        )

    def test_available_slots_hide_closed_and_busy_time(self) -> None:
        compact_hours = WorkHours(
            weekdays={2},
            starts_at=time(10, 0),
            ends_at=time(12, 0),
            slot_step_minutes=60,
        )
        self.storage.add_closed_slot(
            ClosedSlot(
                starts_at=datetime(2026, 5, 12, 10, 0),
                ends_at=datetime(2026, 5, 12, 11, 0),
            )
        )
        self.storage.add_lesson(
            Lesson(
                student_id=self.student.id,
                starts_at=datetime(2026, 5, 12, 11, 0),
                duration_minutes=60,
            )
        )

        self.assertEqual(available_slots(self.storage, date(2026, 5, 12), 60, compact_hours), [])

    def test_cancel_lesson_does_not_charge_balance(self) -> None:
        self.student.balance_lessons = 2
        self.storage.update_student(self.student)
        lesson = self.storage.add_lesson(
            Lesson(
                student_id=self.student.id,
                starts_at=datetime(2026, 5, 12, 18, 0),
                duration_minutes=90,
            )
        )

        cancel_lesson(self.storage, lesson.id, Role.STUDENT.value, "болеет")

        updated_lesson = self.storage.get_lesson(lesson.id)
        updated_student = self.storage.get_student(self.student.id)
        self.assertEqual(updated_lesson.status, LessonStatus.CANCELLED_BY_STUDENT.value)
        self.assertFalse(updated_lesson.charged)
        self.assertEqual(updated_student.balance_lessons, 2)

    def test_move_lesson_updates_time_and_duration(self) -> None:
        lesson = self.storage.add_lesson(
            Lesson(
                student_id=self.student.id,
                starts_at=datetime(2026, 5, 12, 18, 0),
                duration_minutes=90,
            )
        )

        moved = move_lesson(
            self.storage,
            lesson.id,
            datetime(2026, 5, 13, 19, 0),
            60,
            self.work_hours,
        )

        updated = self.storage.get_lesson(lesson.id)
        self.assertEqual(moved.starts_at, datetime(2026, 5, 13, 19, 0))
        self.assertEqual(moved.duration_minutes, 60)
        self.assertEqual(updated.starts_at, datetime(2026, 5, 13, 19, 0))
        self.assertEqual(updated.duration_minutes, 60)

    def test_move_lesson_rejects_busy_slot(self) -> None:
        first = self.storage.add_lesson(
            Lesson(
                student_id=self.student.id,
                starts_at=datetime(2026, 5, 12, 18, 0),
                duration_minutes=90,
            )
        )
        self.storage.add_lesson(
            Lesson(
                student_id=self.student.id,
                starts_at=datetime(2026, 5, 13, 19, 0),
                duration_minutes=60,
            )
        )

        with self.assertRaises(SlotUnavailableError):
            move_lesson(
                self.storage,
                first.id,
                datetime(2026, 5, 13, 19, 30),
                60,
                self.work_hours,
            )

        updated = self.storage.get_lesson(first.id)
        self.assertEqual(updated.starts_at, datetime(2026, 5, 12, 18, 0))
        self.assertEqual(updated.duration_minutes, 90)

    def test_archive_student_hides_student_and_cancels_planned_lessons(self) -> None:
        lesson = self.storage.add_lesson(
            Lesson(
                student_id=self.student.id,
                starts_at=datetime(2026, 5, 12, 18, 0),
                duration_minutes=90,
            )
        )

        self.storage.archive_student(self.student.id)

        self.assertEqual(self.storage.list_students(), [])
        updated_lesson = self.storage.get_lesson(lesson.id)
        self.assertEqual(updated_lesson.status, LessonStatus.CANCELLED_BY_TEACHER.value)

    def test_delete_student_removes_card_lessons_and_linked_accounts(self) -> None:
        lesson = self.storage.add_lesson(
            Lesson(
                student_id=self.student.id,
                starts_at=datetime(2026, 5, 12, 18, 0),
                duration_minutes=90,
            )
        )
        self.storage.upsert_user(
            UserAccount(
                telegram_id=123,
                role=Role.STUDENT.value,
                student_id=self.student.id,
                username="ivan",
            )
        )

        self.storage.delete_student(self.student.id)

        self.assertIsNone(self.storage.get_student(self.student.id))
        self.assertIsNone(self.storage.get_lesson(lesson.id))
        self.assertIsNone(self.storage.get_user(123))

    def test_student_progress_is_persisted(self) -> None:
        updated = self.storage.get_student(self.student.id)

        self.assertEqual(updated.progress_current, 2)
        self.assertEqual(updated.progress_goal, 15)

    def test_prep_plan_and_knowledge_level_are_persisted(self) -> None:
        self.student.prep_plan_text = "Идем по заданиям 1-5, потом пробник."
        self.student.prep_plan_file_id = "photo-file-id"
        self.storage.update_student(self.student)
        topic = self.storage.upsert_prep_topic(
            PrepTopic(student_id=self.student.id, title="Задание 1", knowledge_level=7)
        )

        updated_student = self.storage.get_student(self.student.id)
        updated_topic = self.storage.get_prep_topic(topic.id)
        self.assertEqual(updated_student.prep_plan_text, "Идем по заданиям 1-5, потом пробник.")
        self.assertEqual(updated_student.prep_plan_file_id, "photo-file-id")
        self.assertEqual(updated_topic.knowledge_level, 7)


if __name__ == "__main__":
    unittest.main()
