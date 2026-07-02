from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from tutor_bot.domain.models import StudentProfile
from tutor_bot.services.homework import assign_homework, submit_homework
from tutor_bot.storage.sqlite import SQLiteStorage


class HomeworkTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.storage = SQLiteStorage(Path(self.tempdir.name) / "test.sqlite3")

    def tearDown(self) -> None:
        self.storage.close()
        self.tempdir.cleanup()

    def test_student_cannot_submit_another_students_homework(self) -> None:
        first = self.storage.add_student(StudentProfile(full_name="Иван"))
        second = self.storage.add_student(StudentProfile(full_name="Маша"))
        homework = assign_homework(self.storage, first.id, "Решить вариант")

        with self.assertRaises(ValueError):
            submit_homework(self.storage, homework.id, second.id, "готово")


if __name__ == "__main__":
    unittest.main()
