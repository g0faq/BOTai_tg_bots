from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol

from tutor_bot.domain.enums import HomeworkStatus
from tutor_bot.domain.models import Homework, HomeworkSubmission


class HomeworkStorage(Protocol):
    def add_homework(self, homework: Homework) -> Homework: ...

    def get_homework(self, homework_id: int) -> Homework | None: ...

    def update_homework(self, homework: Homework) -> None: ...

    def add_homework_submission(self, submission: HomeworkSubmission) -> HomeworkSubmission: ...


def assign_homework(
    storage: HomeworkStorage,
    student_id: int,
    text: str,
    deadline: datetime | None = None,
    materials: list[str] | None = None,
) -> Homework:
    return storage.add_homework(
        Homework(
            student_id=student_id,
            text=text,
            deadline=deadline,
            materials=materials or [],
        )
    )


def submit_homework(
    storage: HomeworkStorage,
    homework_id: int,
    student_id: int,
    content: str = "",
    file_ids: list[str] | None = None,
) -> HomeworkSubmission:
    homework = storage.get_homework(homework_id)
    if homework is None:
        raise ValueError("homework not found")
    if homework.student_id != student_id:
        raise ValueError("homework belongs to another student")
    submission = storage.add_homework_submission(
        HomeworkSubmission(
            homework_id=homework_id,
            student_id=student_id,
            content=content,
            file_ids=file_ids or [],
        )
    )
    homework.status = HomeworkStatus.SUBMITTED.value
    storage.update_homework(homework)
    return submission


def review_homework(
    storage: HomeworkStorage,
    homework_id: int,
    status: str,
    teacher_comment: str = "",
) -> Homework:
    if status not in {HomeworkStatus.CHECKED.value, HomeworkStatus.NEEDS_FIX.value}:
        raise ValueError("review status must be checked or needs_fix")
    homework = storage.get_homework(homework_id)
    if homework is None:
        raise ValueError("homework not found")
    homework.status = status
    homework.teacher_comment = teacher_comment
    homework.checked_at = datetime.now(UTC)
    storage.update_homework(homework)
    return homework
