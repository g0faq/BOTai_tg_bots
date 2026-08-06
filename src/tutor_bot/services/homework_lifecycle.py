"""Жизненный цикл домашних заданий после сдачи.

Правила:

* на следующий день после сдачи домашка уходит в архив — из рабочих
  списков пропадает, но остаётся доступной в режиме архива;
* через 10 дней после сдачи удаляется вместе со сдачами.

Дата сдачи берётся по последней записи в ``homework_submissions``. Если
сдачи нет, но статус говорит о завершении, ориентируемся на ``updated_at``:
преподаватель мог отметить выполнение вручную, не дожидаясь отправки.

Несданное не архивируется и не удаляется никогда, каким бы старым оно ни
было: пропавшее задание выглядело бы как потерянные данные.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from tutor_bot.domain.enums import HomeworkStatus
from tutor_bot.domain.models import Homework

ARCHIVE_AFTER_DAYS = 1
PURGE_AFTER_DAYS = 10

#: Статусы, которые считаются завершением работы над заданием.
FINISHED_STATUSES = frozenset({
    HomeworkStatus.SUBMITTED.value,
    HomeworkStatus.SUBMITTED_LATE.value,
    HomeworkStatus.DONE.value,
    HomeworkStatus.CHECKED.value,
    HomeworkStatus.CANCELLED.value,
})


def submitted_at(homework: Homework, submissions: dict[int, datetime]) -> datetime | None:
    """Когда задание было сдано или закрыто. None — работа ещё идёт."""
    if homework.id is not None:
        stamp = submissions.get(int(homework.id))
        if stamp is not None:
            return _naive(stamp)
    if homework.status in FINISHED_STATUSES:
        return _naive(homework.updated_at or homework.created_at)
    return None


def _naive(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=None) if value.tzinfo else value


def _days_since(stamp: datetime, now: datetime) -> int:
    """Календарных дней между сдачей и сейчас, без учёта времени суток."""
    return (date(now.year, now.month, now.day) - date(stamp.year, stamp.month, stamp.day)).days


def is_archived(homework: Homework, submissions: dict[int, datetime], now: datetime) -> bool:
    """Ушла ли домашка в архив: сдана и наступил следующий календарный день."""
    stamp = submitted_at(homework, submissions)
    if stamp is None:
        return False
    return _days_since(stamp, now) >= ARCHIVE_AFTER_DAYS


def is_expired(homework: Homework, submissions: dict[int, datetime], now: datetime) -> bool:
    """Пора ли удалять: прошло 10 дней с момента сдачи."""
    stamp = submitted_at(homework, submissions)
    if stamp is None:
        return False
    return stamp <= now - timedelta(days=PURGE_AFTER_DAYS)


@dataclass
class Split:
    """Разделение списка на рабочую часть и архив."""

    current: list[Homework] = field(default_factory=list)
    archived: list[Homework] = field(default_factory=list)


def split_homeworks(homeworks: list[Homework], submissions: dict[int, datetime], now: datetime) -> Split:
    result = Split()
    for homework in homeworks:
        if is_archived(homework, submissions, now):
            result.archived.append(homework)
        else:
            result.current.append(homework)
    return result


def purge_expired(db, now: datetime) -> list[int]:
    """Удаляет домашки, сданные больше 10 дней назад. Возвращает их id."""
    submissions = db.homework_submission_dates()
    removed: list[int] = []
    for homework in db.list_homeworks(limit=10000):
        if homework.id is None:
            continue
        if is_expired(homework, submissions, now):
            db.delete_homework(int(homework.id))
            removed.append(int(homework.id))
    return removed
