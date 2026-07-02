from __future__ import annotations

from datetime import date, datetime, time, timedelta
from html import escape

from tutor_bot.domain.enums import LessonStatus
from tutor_bot.domain.models import Homework, Lesson, Payment, PlanItem, PrepTopic, StudentProfile
from tutor_bot.services.timezones import DEFAULT_TIMEZONE, convert_timezone, timezone_label
from tutor_bot.storage.sqlite import SQLiteStorage

MONTHS_RU = {
    1: "января",
    2: "февраля",
    3: "марта",
    4: "апреля",
    5: "мая",
    6: "июня",
    7: "июля",
    8: "августа",
    9: "сентября",
    10: "октября",
    11: "ноября",
    12: "декабря",
}


def day_label(value: date) -> str:
    return f"{value.day} {MONTHS_RU[value.month]}"


def ru_dt(value: datetime, timezone: str | None = None, source_timezone: str = DEFAULT_TIMEZONE) -> str:
    shown = convert_timezone(value, source_timezone, timezone) if timezone else value
    suffix = f", {timezone_label(timezone)}" if timezone else ""
    return f"{shown.strftime('%H:%M')} ({day_label(shown.date())}{suffix})"


def ru_dt_text(value: datetime, timezone: str | None = None, source_timezone: str = DEFAULT_TIMEZONE) -> str:
    shown = convert_timezone(value, source_timezone, timezone) if timezone else value
    suffix = f" {timezone_label(timezone)}" if timezone else ""
    return f"{day_label(shown.date())} {shown.strftime('%H:%M')}{suffix}"


def ru_date(value: date) -> str:
    return f"({day_label(value)})"


def ru_time(value: time) -> str:
    return value.strftime("%H:%M")


def student_line(student: StudentProfile) -> str:
    chat = f" | чат: {student_chat_link(student)}" if student_chat_link(student) else ""
    return f"#{student.id} {student.full_name} | {student.prep_type}{chat}"


def should_show_progress(student: StudentProfile) -> bool:
    return student.progress_goal > 0


def format_progress(student: StudentProfile) -> str:
    if student.progress_goal <= 0:
        return "не задан"
    percent = round(student.progress_current / student.progress_goal * 100)
    return f"{percent}% ({student.progress_current}/{student.progress_goal})"


def format_knowledge_progress(topics: list[PrepTopic]) -> str:
    if not topics:
        return "нет заданий"
    filled = [topic for topic in topics if topic.knowledge_level > 0]
    average = round(sum(topic.knowledge_level for topic in topics) / len(topics), 1)
    lines = [f"Средний уровень: {average}/10; заполнено: {len(filled)}/{len(topics)}"]
    for topic in topics:
        lines.append(f"{topic.title}: {topic.knowledge_level}/10")
    return "\n".join(lines)


def lesson_price_for_duration(student: StudentProfile, duration_minutes: int) -> int:
    if duration_minutes == 60:
        return student.price_60 or student.lesson_price
    if duration_minutes == 90:
        return student.price_90 or round((student.price_60 or student.lesson_price) * 1.5)
    if duration_minutes == 120:
        return student.price_120 or (student.price_60 or student.lesson_price) * 2
    return round((student.price_60 or student.lesson_price) * duration_minutes / 60)


def format_lesson_price_for_duration(student: StudentProfile, duration_minutes: int) -> str:
    price = lesson_price_for_duration(student, duration_minutes)
    return f"{price} руб." if price > 0 else "-"


def format_prices(student: StudentProfile) -> str:
    return (
        f"60 мин: {format_lesson_price_for_duration(student, 60)}; "
        f"90 мин: {format_lesson_price_for_duration(student, 90)}; "
        f"120 мин: {format_lesson_price_for_duration(student, 120)}"
    )


def lesson_public_time(
    lesson: Lesson,
    student: StudentProfile | None = None,
    teacher_timezone: str = DEFAULT_TIMEZONE,
) -> str:
    student_timezone = student.timezone if student else teacher_timezone
    if student_timezone and student_timezone != teacher_timezone:
        student_time = ru_dt(lesson.starts_at, student_timezone, teacher_timezone)
        teacher_time = ru_dt(lesson.starts_at, teacher_timezone, teacher_timezone)
        return f"{student_time} / {teacher_time}"
    return ru_dt(lesson.starts_at, teacher_timezone, teacher_timezone)


def lesson_admin_time(
    lesson: Lesson,
    student: StudentProfile | None = None,
    teacher_timezone: str = DEFAULT_TIMEZONE,
) -> str:
    teacher_time = ru_dt(lesson.starts_at, teacher_timezone, teacher_timezone)
    if student and student.timezone and student.timezone != teacher_timezone:
        return f"{teacher_time} / у ученика {ru_dt(lesson.starts_at, student.timezone, teacher_timezone)}"
    return teacher_time


def student_chat_link(student: StudentProfile) -> str:
    contact = student.student_telegram.strip()
    if not contact:
        return ""
    if contact.startswith("@"):
        return f"https://t.me/{contact[1:]}"
    if contact.isdigit():
        return f"tg://user?id={contact}"
    return contact


def student_chat_html(student: StudentProfile) -> str:
    link = student_chat_link(student)
    if not link:
        return "не указан"
    return f'<a href="{escape(link, quote=True)}">{escape(student.full_name)}</a>'


def lesson_line(
    lesson: Lesson,
    student: StudentProfile | None = None,
    teacher_timezone: str = DEFAULT_TIMEZONE,
) -> str:
    name = student.full_name if student else f"ученик #{lesson.student_id}"
    return (
        f"#{lesson.id} {lesson_admin_time(lesson, student, teacher_timezone)} - {name}, "
        f"{lesson.duration_minutes} мин., {lesson.status}"
    )


def lesson_public_line(
    lesson: Lesson,
    student: StudentProfile | None = None,
    teacher_timezone: str = DEFAULT_TIMEZONE,
) -> str:
    name = student.full_name if student else "занятие"
    return f"{lesson_public_time(lesson, student, teacher_timezone)} - {name}, {lesson.duration_minutes} мин., {lesson.status}"


def payment_line(payment: Payment, student: StudentProfile | None = None) -> str:
    name = student.full_name if student else f"ученик #{payment.student_id}"
    if payment.amount <= 0 and payment.lessons_count <= 0:
        return f"#{payment.id} {name}: чек, {payment.status}"
    if payment.amount <= 0:
        return f"#{payment.id} {name}: {payment.lessons_count} зан., {payment.status}"
    return (
        f"#{payment.id} {name}: {payment.amount} руб., "
        f"{payment.lessons_count} зан., {payment.status}"
    )


def homework_line(homework: Homework) -> str:
    deadline = f"\nДедлайн: {ru_dt(homework.deadline)}" if homework.deadline else ""
    comment = f"\nКомментарий: {homework.teacher_comment}" if homework.teacher_comment else ""
    return f"ДЗ #{homework.id}: {homework.status}\n{homework.text}{deadline}{comment}"


def format_student_card(
    student: StudentProfile,
    lessons: list[Lesson],
    homework: Homework | None,
    topics: list[PrepTopic],
    plan: list[PlanItem],
    now: datetime | None = None,
    teacher_timezone: str = DEFAULT_TIMEZONE,
) -> str:
    now = now or datetime.now()
    next_lesson = next(
        (
            lesson
            for lesson in sorted(lessons, key=lambda item: item.starts_at)
            if lesson.status == LessonStatus.PLANNED.value and lesson.starts_at >= now
        ),
        None,
    )
    last_lesson = next(
        (
            lesson
            for lesson in sorted(lessons, key=lambda item: item.starts_at, reverse=True)
            if lesson.status == LessonStatus.CONDUCTED.value
        ),
        None,
    )
    cooperation_start = day_label(student.start_date) if student.start_date else "не указано"
    lines = [
        f"Карточка ученика #{student.id}",
        f"ФИО: {student.full_name}",
        f"Класс: {student.grade}",
        f"Подготовка: {student.prep_type}, {student.subject}",
        f"Цель: {student.goal}",
        f"Начало сотрудничества: {cooperation_start}",
        f"Стоимость: {format_prices(student)}",
        f"Родитель: {student.parent_name} {student.parent_telegram}",
        f"Ученик: {student.student_telegram}",
        f"Часовой пояс: {timezone_label(student.timezone)} ({student.timezone})",
        f"Ближайшее занятие: {lesson_admin_time(next_lesson, student, teacher_timezone) if next_lesson else 'нет'}",
        f"Последнее занятие: {lesson_admin_time(last_lesson, student, teacher_timezone) if last_lesson else 'нет'}",
        f"Текущее ДЗ: #{homework.id} {homework.status}" if homework else "Текущее ДЗ: нет",
        f"Прогресс: {format_progress(student)}" if should_show_progress(student) else "",
        f"План подготовки: {'картинка' if student.prep_plan_file_id else student.prep_plan_text or 'не задан'}",
        f"Доска: {student.board_url or 'не указана'}",
        f"Телемост: {student.meeting_url or 'не указан'}",
        f"Заметки преподавателя: {student.comment or 'нет'}",
    ]
    return "\n".join(line for line in lines if line)


def format_student_public_card(student: StudentProfile) -> str:
    return "\n".join(
        [
            "Моя карточка",
            f"ФИО: {student.full_name}",
            f"Класс: {student.grade}",
            f"Предмет: {student.subject}",
            f"Подготовка: {student.prep_type}",
            f"Цель: {student.goal}",
            f"Уровень знаний: {student.current_level or 'не указан'}",
            f"Стоимость: {format_prices(student)}",
            f"Часовой пояс: {timezone_label(student.timezone)} ({student.timezone})",
            f"Доска: {student.board_url or 'не указана'}",
            f"Телемост: {student.meeting_url or 'не указан'}",
        ]
    )


def format_schedule(storage: SQLiteStorage, start_day: date, days: int) -> str:
    lines: list[str] = []
    for offset in range(days):
        day = start_day + timedelta(days=offset)
        start = datetime.combine(day, time.min)
        end = start + timedelta(days=1)
        lessons = storage.list_lessons_between(start, end, include_cancelled=False)
        lines.append(ru_date(day))
        if not lessons:
            lines.append("  занятий нет")
            continue
        for lesson in lessons:
            student = storage.get_student(lesson.student_id)
            lines.append(f"  {lesson_line(lesson, student)}")
    return "\n".join(lines)
