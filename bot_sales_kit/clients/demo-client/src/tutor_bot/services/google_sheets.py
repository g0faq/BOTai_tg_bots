from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Protocol

from tutor_bot.config import Settings
from tutor_bot.domain.models import Lesson, StudentProfile
from tutor_bot.services.payments import calculate_lesson_cost

SCOPES = ("https://www.googleapis.com/auth/spreadsheets",)
LESSONS_SHEET = "Уроки"
STATS_SHEET = "Статистика"
LESSON_HEADERS = [
    "ID урока",
    "Дата",
    "Месяц",
    "Время",
    "Ученик",
    "Предмет",
    "Длительность, мин",
    "Рабочие часы",
    "Стоимость",
    "Тема",
    "План дальше",
]


def sheet_range(sheet_title: str, cells: str) -> str:
    escaped = sheet_title.replace("'", "''")
    return f"'{escaped}'!{cells}"


class SheetsStorage(Protocol):
    def get_student(self, student_id: int) -> StudentProfile | None: ...

    def list_conducted_lessons(self) -> list[Lesson]: ...


@dataclass(frozen=True, slots=True)
class LessonSheetRow:
    lesson_id: int
    starts_at: datetime
    student_name: str
    subject: str
    duration_minutes: int
    work_hours: float
    salary_amount: int
    topic: str
    next_plan: str

    def to_values(self) -> list[object]:
        return [
            self.lesson_id,
            self.starts_at.date().isoformat(),
            self.starts_at.strftime("%Y-%m"),
            self.starts_at.strftime("%H:%M"),
            self.student_name,
            self.subject,
            self.duration_minutes,
            self.work_hours,
            self.salary_amount,
            self.topic,
            self.next_plan,
        ]


def collect_lesson_rows(storage: SheetsStorage) -> list[LessonSheetRow]:
    rows: list[LessonSheetRow] = []
    for lesson in storage.list_conducted_lessons():
        if lesson.id is None:
            continue
        student = storage.get_student(lesson.student_id)
        if student is None:
            continue
        rows.append(
            LessonSheetRow(
                lesson_id=lesson.id,
                starts_at=lesson.starts_at,
                student_name=student.full_name,
                subject=student.subject,
                duration_minutes=lesson.duration_minutes,
                work_hours=round(lesson.duration_minutes / 60, 2),
                salary_amount=calculate_lesson_cost(student, lesson),
                topic=lesson.topic,
                next_plan=lesson.next_plan,
            )
        )
    return rows


def build_stats_values(rows: list[LessonSheetRow]) -> list[list[object]]:
    total_lessons = len(rows)
    total_hours = round(sum(row.work_hours for row in rows), 2)
    total_salary = sum(row.salary_amount for row in rows)

    values: list[list[object]] = [
        ["Показатель", "Значение"],
        ["Проведено уроков", total_lessons],
        ["Рабочие часы", total_hours],
        ["Зарплата", total_salary],
        [],
        ["По месяцам", "", "", ""],
        ["Месяц", "Уроки", "Рабочие часы", "Зарплата"],
    ]

    by_month: dict[str, list[float | int]] = defaultdict(lambda: [0, 0.0, 0])
    for row in rows:
        month = row.starts_at.strftime("%Y-%m")
        by_month[month][0] += 1
        by_month[month][1] += row.work_hours
        by_month[month][2] += row.salary_amount
    for month in sorted(by_month):
        lessons, hours, salary = by_month[month]
        values.append([month, lessons, round(float(hours), 2), salary])

    values.extend([[], ["По ученикам", "", "", ""], ["Ученик", "Уроки", "Рабочие часы", "Зарплата"]])
    by_student: dict[str, list[float | int]] = defaultdict(lambda: [0, 0.0, 0])
    for row in rows:
        by_student[row.student_name][0] += 1
        by_student[row.student_name][1] += row.work_hours
        by_student[row.student_name][2] += row.salary_amount
    for student_name in sorted(by_student):
        lessons, hours, salary = by_student[student_name]
        values.append([student_name, lessons, round(float(hours), 2), salary])

    return values


class GoogleSheetsReporter:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._service = None

    def sync_conducted_lessons(self, storage: SheetsStorage) -> int:
        if not self.settings.google_sheets_enabled:
            return 0
        rows = collect_lesson_rows(storage)
        self._ensure_sheets()
        self._clear_ranges()
        body = {
            "valueInputOption": "USER_ENTERED",
            "data": [
                {
                    "range": sheet_range(LESSONS_SHEET, f"A1:K{max(len(rows) + 1, 1)}"),
                    "values": [LESSON_HEADERS] + [row.to_values() for row in rows],
                },
                {
                    "range": sheet_range(STATS_SHEET, "A1:D200"),
                    "values": build_stats_values(rows),
                },
            ],
        }
        self.service.spreadsheets().values().batchUpdate(
            spreadsheetId=self.settings.google_sheets_spreadsheet_id,
            body=body,
        ).execute()
        return len(rows)

    @property
    def service(self):
        if self._service is None:
            self._service = self._build_service()
        return self._service

    def _build_service(self):
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build

        credentials_info = self.settings.google_sheets_credentials_info()
        if credentials_info is not None:
            credentials = Credentials.from_service_account_info(credentials_info, scopes=SCOPES)
        else:
            credentials = Credentials.from_service_account_file(
                Path(self.settings.google_sheets_credentials_file), scopes=SCOPES
            )
        return build("sheets", "v4", credentials=credentials, cache_discovery=False)

    def _ensure_sheets(self) -> None:
        spreadsheet = self.service.spreadsheets().get(
            spreadsheetId=self.settings.google_sheets_spreadsheet_id
        ).execute()
        existing = {sheet["properties"]["title"] for sheet in spreadsheet.get("sheets", [])}
        requests = [
            {"addSheet": {"properties": {"title": title}}}
            for title in (LESSONS_SHEET, STATS_SHEET)
            if title not in existing
        ]
        if requests:
            self.service.spreadsheets().batchUpdate(
                spreadsheetId=self.settings.google_sheets_spreadsheet_id,
                body={"requests": requests},
            ).execute()

    def _clear_ranges(self) -> None:
        for sheet in (LESSONS_SHEET, STATS_SHEET):
            self.service.spreadsheets().values().clear(
                spreadsheetId=self.settings.google_sheets_spreadsheet_id,
                range=sheet_range(sheet, "A:Z"),
                body={},
            ).execute()
