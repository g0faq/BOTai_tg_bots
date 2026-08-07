from __future__ import annotations

import asyncio
import logging
import os
from datetime import timedelta
from pathlib import Path

from aiogram import Bot, Dispatcher
from aiogram.exceptions import TelegramNetworkError
from aiogram.types import MenuButtonWebApp, WebAppInfo

from tutor_bot.bot.formatters import lesson_price_for_duration, ru_dt_text
from tutor_bot.bot.handlers import router
from tutor_bot.config import Settings, load_dotenv, load_settings
from tutor_bot.domain.enums import BalanceMode, LessonPaymentStatus, LessonStatus, PlanItemStatus
from tutor_bot.services.google_sheets import GoogleSheetsReporter
from tutor_bot.services.homework_lifecycle import purge_expired
from tutor_bot.services.payments import mark_lesson_conducted
from tutor_bot.services.scheduling import WorkHours
from tutor_bot.storage.sqlite import SQLiteStorage

TRUTHY_ENV_VALUES = {"1", "true", "yes", "on"}
REMINDER_LOOP_INTERVAL_SECONDS = 60
REMINDER_RESTART_DELAYS = (5, 10, 20, 60)


def build_work_hours(settings: Settings) -> WorkHours:
    return WorkHours(
        weekdays=set(settings.working_days),
        starts_at=settings.working_start,
        ends_at=settings.working_end,
        slot_step_minutes=settings.slot_step_minutes,
    )


async def reminder_loop(bot: Bot, db: SQLiteStorage, settings: Settings) -> None:
    """Бесконечный цикл напоминаний.

    Раньше исключение внутри итерации навсегда убивало таск: процесс оставался
    жив, polling работал, а напоминания молча прекращались. Теперь итерация
    изолирована, а трейсбек уходит в лог.
    """
    while True:
        try:
            await run_reminder_iteration(bot, db, settings)
        except asyncio.CancelledError:
            raise
        except Exception:
            logging.exception("Reminder loop iteration failed")
        await asyncio.sleep(REMINDER_LOOP_INTERVAL_SECONDS)


async def run_reminder_iteration(bot: Bot, db: SQLiteStorage, settings: Settings) -> None:
    now = settings.local_now()
    await auto_complete_lessons(bot, db, settings, now)
    removed = purge_expired(db, now)
    if removed:
        logging.info("Purged %s homeworks older than 10 days since submission: %s", len(removed), removed)
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
        delivered = False
        for admin_id in settings.admin_telegram_ids:
            delivered = await safe_send_message(bot, admin_id, admin_text) or delivered

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
            delivered = await safe_send_message(bot, user.telegram_id, student_text) or delivered

        # Флаг ставим только после реальной доставки: иначе неудачная отправка
        # навсегда исключает занятие из выборки и напоминание теряется.
        if not delivered:
            logging.warning("Reminder for lesson %s was not delivered, will retry", lesson.id)
            continue
        lesson.reminder_sent_at = settings.local_now()
        db.update_lesson(lesson)

    recent_start = now - timedelta(hours=12)
    recent_lessons = db.list_lessons_between(recent_start, now, include_cancelled=False)
    for lesson in recent_lessons:
        if (
            lesson.status != LessonStatus.CONDUCTED.value
            or lesson.post_lesson_reminder_sent_at
            or lesson.ends_at + timedelta(minutes=10) > now
            or lesson.payment_status == LessonPaymentStatus.CONFIRMED.value
        ):
            continue
        student = db.get_student(lesson.student_id)
        if student is None:
            continue
        amount = lesson.payment_amount or lesson_price_for_duration(student, lesson.duration_minutes)
        text = "\n".join(
            [
                "💳 Оплата занятия",
                "",
                f"Сумма к оплате: {amount} ₽",
                "Пожалуйста, оплати занятие и отметь оплату в Mini App или пришли чек в бот.",
                "",
                "+79779742510",
                "Строго Т-Банк.",
            ]
        )
        delivered = False
        for user in db.list_users_by_student(student.id):
            delivered = await safe_send_message(bot, user.telegram_id, text) or delivered
        if not delivered:
            continue
        lesson.post_lesson_reminder_sent_at = settings.local_now()
        db.update_lesson(lesson)

    await remind_debtors_next_day(bot, db, settings, now)


async def auto_complete_lessons(bot: Bot, db: SQLiteStorage, settings: Settings, now) -> None:
    recent_start = now - timedelta(hours=12)
    for lesson in db.list_lessons_between(recent_start, now, include_cancelled=False):
        if lesson.status != LessonStatus.PLANNED.value or lesson.ends_at + timedelta(minutes=10) > now:
            continue
        student = db.get_student(lesson.student_id)
        if student is None:
            continue
        prepaid = (
            student.balance_lessons > 0
            if student.balance_mode == BalanceMode.LESSONS.value
            else student.balance_money >= lesson_price_for_duration(student, lesson.duration_minutes)
        )
        mark_lesson_conducted(db, int(lesson.id))
        lesson = db.get_lesson(int(lesson.id))
        if lesson is None:
            continue
        if lesson.payment_status != LessonPaymentStatus.CONFIRMED.value:
            lesson.payment_status = LessonPaymentStatus.CONFIRMED.value if prepaid else LessonPaymentStatus.UNPAID.value
            if prepaid:
                lesson.payment_marked_by = "auto"
                lesson.payment_confirmed_at = settings.local_now()
            lesson.payment_amount = lesson.payment_amount or lesson_price_for_duration(student, lesson.duration_minutes)
            db.update_lesson(lesson)


async def remind_debtors_next_day(bot: Bot, db: SQLiteStorage, settings: Settings, now) -> None:
    today = now.date()
    yesterday_start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
    for student in db.list_students_for_debt_reminder(today):
        if student.id is None:
            continue
        unpaid = [
            lesson
            for lesson in db.list_student_lessons(student.id, limit=1000)
            if lesson.status == LessonStatus.CONDUCTED.value
            and lesson.payment_status in {LessonPaymentStatus.NOT_MARKED.value, LessonPaymentStatus.UNPAID.value}
            and lesson.ends_at >= yesterday_start
        ]
        if not unpaid:
            continue
        amount = sum(lesson.payment_amount or lesson_price_for_duration(student, lesson.duration_minutes) for lesson in unpaid)
        text = "\n".join(
            [
                "💳 Напоминание об оплате",
                "",
                f"К оплате: {amount} ₽",
                "Пожалуйста, оплати занятия по реквизитам:",
                "+79779742510",
                "Строго Т-Банк.",
            ]
        )
        sent = False
        for user in db.list_users_by_student(student.id):
            sent = await safe_send_message(bot, user.telegram_id, text) or sent
        if sent:
            db.mark_debt_reminder_sent(student.id, today)


class ReminderSupervisor:
    """Следит за таском напоминаний и перезапускает его при падении.

    Второй рубеж защиты после try/except внутри самого цикла: сюда попадают
    только те падения, которые цикл поймать не смог.
    """

    def __init__(self, bot: Bot, db: SQLiteStorage, settings: Settings) -> None:
        self._bot = bot
        self._db = db
        self._settings = settings
        self._attempt = 0
        self._stopped = False
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._spawn()

    def _spawn(self) -> None:
        self._task = asyncio.create_task(reminder_loop(self._bot, self._db, self._settings))
        self._task.add_done_callback(self._on_done)

    def _on_done(self, task: asyncio.Task) -> None:
        if self._stopped or task.cancelled():
            return
        error = task.exception()
        if error is None:
            return
        delay = REMINDER_RESTART_DELAYS[min(self._attempt, len(REMINDER_RESTART_DELAYS) - 1)]
        self._attempt += 1
        logging.error("Reminder loop crashed, restarting in %s seconds", delay, exc_info=error)
        asyncio.create_task(self._restart_after(delay))

    async def _restart_after(self, delay: int) -> None:
        await asyncio.sleep(delay)
        if self._stopped:
            return
        self._spawn()

    def stop(self) -> None:
        self._stopped = True
        if self._task is not None:
            self._task.cancel()


async def safe_send_message(bot: Bot, chat_id: int, text: str) -> bool:
    try:
        await bot.send_message(chat_id, text)
    except Exception:
        logging.exception("Failed to send Telegram message to %s", chat_id)
        return False
    return True


async def setup_miniapp_menu_button(bot: Bot, settings: Settings, db: SQLiteStorage) -> None:
    if not settings.telegram_webapp_url:
        return
    menu_button = MenuButtonWebApp(text="Кабинет", web_app=WebAppInfo(url=settings.telegram_webapp_url))

    async def set_menu_button_with_retry(chat_id: int | None = None) -> None:
        for attempt in range(1, 6):
            try:
                await bot.set_chat_menu_button(chat_id=chat_id, menu_button=menu_button)
                return
            except Exception:
                if attempt == 5:
                    logging.exception(
                        "Failed to set Telegram Mini App menu button%s after %s attempts",
                        f" for chat {chat_id}" if chat_id is not None else "",
                        attempt,
                    )
                    return
                logging.warning(
                    "Failed to set Telegram Mini App menu button%s (attempt %s/5), retrying",
                    f" for chat {chat_id}" if chat_id is not None else "",
                    attempt,
                    exc_info=True,
                )
                await asyncio.sleep(attempt * 2)

    await set_menu_button_with_retry()
    known_chat_ids = {user.telegram_id for user in db.list_user_accounts()}
    known_chat_ids.update(settings.admin_telegram_ids)
    for chat_id in sorted(known_chat_ids):
        await set_menu_button_with_retry(chat_id)


def _truthy_env(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in TRUTHY_ENV_VALUES


def _is_server_runtime() -> bool:
    env_file = Path(os.getenv("ENV_FILE", "")).as_posix()
    return (
        os.getenv("BOT_RUNTIME", "").strip().lower() == "server"
        or bool(os.getenv("INVOCATION_ID"))
        or env_file.startswith("/opt/tutor-bots/")
    )


def assert_polling_allowed() -> None:
    if _is_server_runtime() or _truthy_env("ALLOW_LOCAL_BOT_POLLING"):
        return
    raise SystemExit(
        "Local Telegram polling is blocked so this Mac cannot compete with the server. "
        "Run the bot on the VPS via systemd, or set ALLOW_LOCAL_BOT_POLLING=1 only for a short manual test."
    )


async def ensure_polling_mode(bot: Bot) -> None:
    """Снять вебхук перед опросом и записать в лог, что было.

    Пока у бота установлен вебхук, getUpdates молча не отдаёт ничего:
    процесс жив, ошибок нет, но сообщения до обработчиков не доходят.
    Снаружи это выглядит как «бот не отвечает на /start» без единого
    признака поломки — ровно то, что мы и наблюдали: аптайм веба растёт,
    контейнер не перезапускается, а ответов нет.

    Вызов идемпотентен: если вебхука нет, ничего не меняется. Ожидающие
    апдейты не сбрасываем, накопившиеся сообщения дойдут.
    """
    try:
        info = await bot.get_webhook_info()
        if info.url:
            logging.warning(
                "Webhook %s was set — polling would receive nothing. Removing it.", info.url
            )
            await bot.delete_webhook(drop_pending_updates=False)
            logging.info("Webhook removed, switching to polling")
        else:
            logging.info("No webhook is set, pending updates: %s", info.pending_update_count)
    except Exception:
        logging.exception("Failed to check or remove webhook before polling")


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    load_dotenv()
    settings = load_settings()
    if not settings.bot_token:
        raise SystemExit("BOT_TOKEN is empty. Fill .env first.")
    assert_polling_allowed()

    db = SQLiteStorage(settings.database_path)
    bot = Bot(settings.bot_token)
    await setup_miniapp_menu_button(bot, settings, db)
    dp = Dispatcher(
        db=db,
        settings=settings,
        work_hours=build_work_hours(settings),
        google_sheets_reporter=GoogleSheetsReporter(settings),
    )
    dp.include_router(router)

    await ensure_polling_mode(bot)

    supervisor = None
    if not _truthy_env("DISABLE_BACKGROUND_REMINDERS"):
        supervisor = ReminderSupervisor(bot, db, settings)
        supervisor.start()
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
        if supervisor is not None:
            supervisor.stop()
        db.close()
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
