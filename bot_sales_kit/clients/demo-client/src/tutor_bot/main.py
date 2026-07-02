from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from aiogram import Bot, Dispatcher
from aiogram.exceptions import TelegramNetworkError

from tutor_bot.bot.formatters import ru_dt_text
from tutor_bot.bot.handlers import router
from tutor_bot.config import Settings, load_dotenv, load_settings
from tutor_bot.domain.enums import LessonPaymentStatus, LessonStatus, PlanItemStatus
from tutor_bot.services.google_sheets import GoogleSheetsReporter
from tutor_bot.services.scheduling import WorkHours
from tutor_bot.storage.sqlite import SQLiteStorage


def build_work_hours(settings: Settings) -> WorkHours:
    return WorkHours(
        weekdays=set(settings.working_days),
        starts_at=settings.working_start,
        ends_at=settings.working_end,
        slot_step_minutes=settings.slot_step_minutes,
    )


async def reminder_loop(bot: Bot, db: SQLiteStorage, settings: Settings) -> None:
    while True:
        now = settings.local_now()
        window_start = now + timedelta(minutes=settings.reminder_minutes_before_lesson)
        window_end = window_start + timedelta(seconds=70)
        lessons = db.list_lessons_between(window_start, window_end, include_cancelled=False)
        for lesson in lessons:
            if lesson.status != LessonStatus.PLANNED.value or lesson.reminder_sent_at:
                continue
            student = db.get_student(lesson.student_id)
            if student is None:
                continue
            previous = [
                item
                for item in db.list_student_lessons(student.id, limit=30)
                if item.status == LessonStatus.CONDUCTED.value
            ]
            previous_topic = previous[0].topic if previous else "нет данных"
            homework = db.get_current_homework(student.id)
            plan_items = [
                item
                for item in db.list_plan_items(student.id)
                if item.status != PlanItemStatus.DONE.value
            ]
            today_plan = plan_items[0].title if plan_items else lesson.next_plan or "не указан"

            admin_text = "\n".join(
                line
                for line in [
                    "🔔 Напоминание о занятии",
                    f"Через {settings.reminder_minutes_before_lesson} минут",
                    "",
                    f"Ученик: {student.full_name}",
                    f"Время: {ru_dt_text(lesson.starts_at, settings.timezone, settings.timezone)}",
                    f"Длительность: {lesson.duration_minutes} мин",
                    "",
                    f"Прошлая тема: {previous_topic or 'нет данных'}",
                    f"План: {today_plan}",
                    f"ДЗ: {homework.status if homework else 'нет активного ДЗ'}",
                    "",
                    f"Телемост: {student.meeting_url}" if student.meeting_url else "Телемост: не указан",
                    f"Доска: {student.board_url}" if student.board_url else "Доска: не указана",
                    f"Чат: {settings.teacher_chat_link}" if settings.teacher_chat_link else "",
                ]
                if line
            )
            for admin_id in settings.admin_telegram_ids:
                await safe_send_message(bot, admin_id, admin_text)

            student_text = "\n".join(
                line
                for line in [
                    "🔔 Скоро занятие",
                    f"Начало через {settings.reminder_minutes_before_lesson} минут",
                    "",
                    f"Время: {ru_dt_text(lesson.starts_at, student.timezone, settings.timezone)}",
                    f"Длительность: {lesson.duration_minutes} мин",
                    "",
                    f"Звонок: {student.meeting_url}" if student.meeting_url else "Звонок: ссылка пока не указана",
                    f"Доска: {student.board_url}" if student.board_url else "Доска: ссылка пока не указана",
                    f"Чат с преподавателем: {settings.teacher_chat_link}" if settings.teacher_chat_link else "",
                ]
                if line
            )
            for user in db.list_users_by_student(student.id):
                await safe_send_message(bot, user.telegram_id, student_text)

            lesson.reminder_sent_at = settings.local_now()
            db.update_lesson(lesson)

        recent_start = now - timedelta(hours=12)
        recent_lessons = db.list_lessons_between(recent_start, now, include_cancelled=False)
        for lesson in recent_lessons:
            if (
                lesson.status != LessonStatus.CONDUCTED.value
                or lesson.post_lesson_reminder_sent_at
                or lesson.ends_at > now
                or lesson.payment_status == LessonPaymentStatus.CONFIRMED.value
            ):
                continue
            student = db.get_student(lesson.student_id)
            if student is None or student.balance_lessons > 0:
                continue
            text = "\n".join(
                line
                for line in [
                    "💳 Оплата занятия",
                    "",
                    "Пожалуйста, отметь оплату в Mini App или пришли чек в бот.",
                    "",
                    settings.payment_details_text,
                ]
                if line
            )
            for user in db.list_users_by_student(student.id):
                await safe_send_message(bot, user.telegram_id, text)
            lesson.post_lesson_reminder_sent_at = settings.local_now()
            db.update_lesson(lesson)

        await asyncio.sleep(60)


async def safe_send_message(bot: Bot, chat_id: int, text: str) -> bool:
    try:
        await bot.send_message(chat_id, text)
    except Exception:
        logging.exception("Failed to send Telegram message to %s", chat_id)
        return False
    return True


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    load_dotenv()
    settings = load_settings()
    if not settings.bot_token:
        raise SystemExit("BOT_TOKEN is empty. Fill .env first.")

    db = SQLiteStorage(settings.database_path)
    bot = Bot(settings.bot_token)
    dp = Dispatcher(
        db=db,
        settings=settings,
        work_hours=build_work_hours(settings),
        google_sheets_reporter=GoogleSheetsReporter(settings),
    )
    dp.include_router(router)

    reminder_task = asyncio.create_task(reminder_loop(bot, db, settings))
    try:
        while True:
            try:
                await dp.start_polling(bot)
            except TelegramNetworkError:
                logging.exception("Telegram network error, restarting polling in 10 seconds")
                await asyncio.sleep(10)
            else:
                break
    finally:
        reminder_task.cancel()
        db.close()
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
