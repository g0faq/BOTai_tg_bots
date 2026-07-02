from __future__ import annotations

from datetime import UTC, datetime

from tutor_bot.domain.models import Lesson, StudentProfile


def _escape_ics_text(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def _ics_dt(value: datetime) -> str:
    return value.strftime("%Y%m%dT%H%M%S")


def _fold_ics_line(line: str) -> str:
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return line

    chunks: list[str] = []
    current = ""
    for char in line:
        candidate = current + char
        if len(candidate.encode("utf-8")) > 75:
            chunks.append(current)
            current = " " + char
        else:
            current = candidate
    if current:
        chunks.append(current)
    return "\r\n".join(chunks)


def build_lesson_ics(
    lesson: Lesson,
    student: StudentProfile,
    timezone: str = "Europe/Moscow",
) -> str:
    title = _escape_ics_text(f"Занятие: {student.full_name}")
    details = [
        f"Ученик: {student.full_name}",
        f"Подготовка: {student.prep_type}, {student.subject}",
    ]
    if student.meeting_url:
        details.append(f"Телемост: {student.meeting_url}")
    if student.board_url:
        details.append(f"Доска: {student.board_url}")
    if lesson.next_plan:
        details.append(f"План: {lesson.next_plan}")

    description = _escape_ics_text("\n".join(details))
    location = _escape_ics_text(student.meeting_url or "Онлайн")
    uid = f"lesson-{lesson.id or _ics_dt(lesson.starts_at)}@tutor-bot"
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Tutor Bot//Lessons//RU",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{stamp}",
        f"DTSTART;TZID={timezone}:{_ics_dt(lesson.starts_at)}",
        f"DTEND;TZID={timezone}:{_ics_dt(lesson.ends_at)}",
        f"SUMMARY:{title}",
        f"DESCRIPTION:{description}",
        f"LOCATION:{location}",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return "\r\n".join(_fold_ics_line(line) for line in lines) + "\r\n"


def calendar_filename(lesson: Lesson, student: StudentProfile) -> str:
    safe_name = "".join(
        char for char in student.full_name.strip().replace(" ", "_") if char.isalnum() or char == "_"
    )
    name = safe_name or f"student_{student.id}"
    return f"lesson_{lesson.starts_at.strftime('%Y%m%d_%H%M')}_{name}.ics"
