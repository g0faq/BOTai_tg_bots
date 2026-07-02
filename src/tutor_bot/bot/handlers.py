from __future__ import annotations

import hashlib
import secrets
from collections import deque
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, time, timedelta
from html import escape
from time import monotonic
from typing import Any

from aiogram import BaseMiddleware, Bot, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    BufferedInputFile,
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    LinkPreviewOptions,
    Message,
)

from tutor_bot.bot.formatters import (
    day_label,
    format_knowledge_progress,
    format_lesson_price_for_duration,
    format_progress,
    format_student_card,
    format_student_public_card,
    homework_line,
    lesson_line,
    lesson_public_line,
    payment_line,
    ru_date,
    ru_dt,
    student_chat_html,
    student_line,
)
from tutor_bot.bot.keyboards import (
    admin_help_keyboard,
    admin_lesson_actions_keyboard,
    admin_menu,
    admin_schedule_day_keyboard,
    booking_dates_keyboard,
    booking_times_keyboard,
    confirm_delete_student_keyboard,
    confirm_self_delete_keyboard,
    duration_keyboard,
    edit_card_keyboard,
    edit_choice_keyboard,
    first_start_menu,
    homework_submit_keyboard,
    lesson_calendar_keyboard,
    lesson_request_actions_keyboard,
    parent_rights_keyboard,
    payment_actions_keyboard,
    prep_type_keyboard,
    recurring_times_keyboard,
    recurring_weekdays_keyboard,
    role_choice_keyboard,
    schedule_week_keyboard,
    student_admin_actions_keyboard,
    student_lesson_actions_keyboard,
    student_lesson_confirmation_keyboard,
    student_menu,
    student_self_actions_keyboard,
    students_keyboard,
    subject_keyboard,
)
from tutor_bot.config import Settings
from tutor_bot.domain.enums import (
    BalanceMode,
    LessonPaymentStatus,
    LessonStatus,
    PrepTopicStatus,
    Role,
    StudentStatus,
)
from tutor_bot.domain.models import (
    ClosedSlot,
    Lesson,
    Payment,
    PlanItem,
    PrepTopic,
    StudentProfile,
    UserAccount,
)
from tutor_bot.services.calendar import build_lesson_ics, calendar_filename
from tutor_bot.services.google_sheets import GoogleSheetsReporter
from tutor_bot.services.homework import assign_homework, submit_homework
from tutor_bot.services.payments import confirm_payment, mark_lesson_conducted, reject_payment
from tutor_bot.services.preparation import (
    EGE_INFORMATICS_TOPICS,
    exam_task_titles,
    knowledge_status,
)
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
from tutor_bot.services.timezones import convert_timezone, normalize_timezone, timezone_label
from tutor_bot.storage.sqlite import SQLiteStorage

router = Router()


class HideUsedInlineKeyboardMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[CallbackQuery, dict[str, Any]], Awaitable[Any]],
        event: CallbackQuery,
        data: dict[str, Any],
    ) -> Any:
        if event.message and event.message.reply_markup:
            try:
                await event.message.edit_reply_markup(reply_markup=None)
            except Exception:
                pass
        return await handler(event, data)


router.callback_query.middleware(HideUsedInlineKeyboardMiddleware())


class StickerSpamGuard:
    def __init__(self) -> None:
        self._events: dict[int, deque[float]] = {}
        self._blocked_until: dict[int, float] = {}
        self._last_warning_at: dict[int, float] = {}

    def should_warn(
        self,
        key: int,
        *,
        now: float,
        limit: int,
        window_seconds: int,
        block_seconds: int,
        warning_cooldown_seconds: int,
    ) -> bool:
        if limit <= 0:
            return False

        if self._blocked_until.get(key, 0) > now:
            return False

        events = self._events.setdefault(key, deque())
        while events and now - events[0] > window_seconds:
            events.popleft()
        events.append(now)

        if len(events) > limit:
            self._blocked_until[key] = now + block_seconds
            events.clear()

        last_warning_at = self._last_warning_at.get(key, 0)
        if now - last_warning_at < warning_cooldown_seconds:
            return False
        self._last_warning_at[key] = now
        return True


class StickerSpamMiddleware(BaseMiddleware):
    def __init__(self, guard: StickerSpamGuard | None = None) -> None:
        self.guard = guard or StickerSpamGuard()

    async def __call__(
        self,
        handler: Callable[[Message, dict[str, Any]], Awaitable[Any]],
        event: Message,
        data: dict[str, Any],
    ) -> Any:
        if not event.sticker:
            return await handler(event, data)

        settings = data.get("settings")
        if isinstance(settings, Settings) and event.from_user and event.from_user.id in settings.admin_telegram_ids:
            return await handler(event, data)

        chat_id = event.chat.id if event.chat else 0
        key = event.from_user.id if event.from_user else chat_id
        if isinstance(settings, Settings) and self.guard.should_warn(
            key,
            now=monotonic(),
            limit=settings.sticker_spam_limit,
            window_seconds=settings.sticker_spam_window_seconds,
            block_seconds=settings.sticker_spam_block_seconds,
            warning_cooldown_seconds=settings.sticker_spam_warning_cooldown_seconds,
        ):
            try:
                await event.answer("Стикеры не обрабатываю. Напиши текстом или используй кнопки.")
            except Exception:
                pass
        return None


router.message.middleware(StickerSpamMiddleware())


class Questionnaire(StatesGroup):
    choosing_role = State()
    answering = State()


class Booking(StatesGroup):
    choosing_duration = State()
    choosing_date = State()
    choosing_time = State()


class RegularScheduleFlow(StatesGroup):
    choosing_weekday = State()
    choosing_time = State()


class MoveLessonFlow(StatesGroup):
    setup = State()


class AdminEdit(StatesGroup):
    price = State()
    links = State()
    homework = State()


class PaymentFlow(StatesGroup):
    amount = State()
    receipt = State()


class HomeworkSubmit(StatesGroup):
    solution = State()


class CardEdit(StatesGroup):
    value = State()


STUDENT_QUESTIONNAIRE_FIELDS: list[tuple[str, str]] = [
    ("full_name", "ФИО ученика"),
    ("grade", "Класс"),
    ("subject", "Предмет"),
    ("prep_type", "Вид подготовки"),
    ("lesson_price", "Стоимость 60 минут занятия числом, например 1500"),
    ("goal", "Цель подготовки"),
    ("current_level", "Уровень знаний: с нуля, база, средний, сильный или свой вариант"),
    ("timezone", "Часовой пояс относительно Москвы. Например: МСК+0, МСК+2, МСК-1"),
    ("parent_telegram", "Telegram родителя или '-'"),
    ("parent_name", "Имя родителя или '-'"),
    ("parent_can_edit", "Права родителя в кабинете"),
    ("exam_date", "Дата экзамена, если есть, или '-'"),
    ("comment", "Комментарий для преподавателя или '-'"),
]

PARENT_QUESTIONNAIRE_FIELDS: list[tuple[str, str]] = [
    ("parent_name", "Ваше ФИО"),
    ("student_telegram", "Telegram ребенка. Например: @username"),
]

ADMIN_STUDENT_QUESTIONNAIRE_FIELDS: list[tuple[str, str]] = [
    *STUDENT_QUESTIONNAIRE_FIELDS,
    ("student_telegram", "Telegram ученика или '-'"),
    ("parent_telegram", "Telegram родителя или '-'"),
    ("parent_name", "Имя родителя или '-'"),
]

BUTTON_FIELDS = {"subject", "prep_type", "parent_can_edit"}

EDIT_CHOICE_VALUES = {
    "subject": {
        "informatics": "Информатика",
        "math": "Математика",
        "russian": "Русский язык",
        "physics": "Физика",
        "chemistry": "Химия",
        "biology": "Биология",
        "english": "Английский язык",
        "social": "Обществознание",
        "history": "История",
        "literature": "Литература",
    },
    "prep_type": {
        "ege": "ЕГЭ",
        "oge": "ОГЭ",
        "school": "Школьная программа",
        "vpr": "ВПР",
        "dvi": "ДВИ",
        "olymp": "Олимпиады",
        "python": "Python",
    },
}

PROGRESS_GOALS: dict[tuple[str, str], int] = {
    ("егэ", "информ"): 27,
    ("егэ", "матем"): 19,
    ("огэ", "информ"): 19,
    ("огэ", "матем"): 25,
}

EDIT_FIELD_TITLES = {
    "full_name": "ФИО",
    "grade": "класс",
    "goal": "цель",
    "current_level": "уровень знаний (например: с нуля, база, средний, сильный)",
    "exam_date": "дату экзамена в формате ДД.ММ или '-'",
    "lesson_price": "стоимость 60 минут занятия числом. 90 и 120 минут посчитаются автоматически",
    "progress": "прогресс в формате текущий/цель. Например: 2/15",
    "price_60": "стоимость 60 минут числом",
    "price_90": "стоимость 90 минут числом",
    "price_120": "стоимость 120 минут числом",
    "student_telegram": "Telegram ученика",
    "parent_telegram": "Telegram родителя",
    "parent_name": "имя родителя",
    "board_url": "ссылку на доску",
    "meeting_url": "ссылку на Телемост",
    "timezone": "часовой пояс в формате МСК+0, МСК+2 или МСК-1",
    "comment": "заметки преподавателя",
}

SELF_EDIT_FIELDS = {"full_name", "grade", "subject", "prep_type", "goal", "current_level", "timezone", "exam_date"}
BROWSER_INVITE_DAYS = 3650
BROWSER_SESSION_DAYS = 180


def parse_day(raw: str, today: date | None = None) -> date:
    raw = raw.strip()
    if "-" in raw:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    if raw.count(".") == 2:
        return datetime.strptime(raw, "%d.%m.%Y").date()
    parsed = datetime.strptime(raw, "%d.%m").date()
    today = today or date.today()
    candidate = date(today.year, parsed.month, parsed.day)
    if candidate < today:
        candidate = date(today.year + 1, parsed.month, parsed.day)
    return candidate


def parse_clock(raw: str) -> time:
    return datetime.strptime(raw, "%H:%M").time()


def parse_start(raw_day: str, raw_time: str, today: date | None = None) -> datetime:
    return datetime.combine(parse_day(raw_day, today=today), parse_clock(raw_time))


def parse_weekdays(raw: str) -> set[int]:
    values = {positive_int(item, "День недели") for item in raw.replace(";", ",").split(",") if item}
    if not values:
        raise ValueError("Нужно указать дни недели.")
    if any(day < 1 or day > 7 for day in values):
        raise ValueError("Дни недели должны быть числами от 1 до 7.")
    return values


def parse_regular_setup(
    raw: str,
    today: date,
    default_duration: int,
) -> tuple[list[RecurringLessonSlot], date, int]:
    parts = raw.replace(";", " ; ").split()
    if len(parts) < 3:
        raise ValueError("Пример: 1 18:00; 3 16:30 31.08")

    slots: list[RecurringLessonSlot] = []
    index = 0
    while index + 1 < len(parts):
        if parts[index] == ";":
            index += 1
            continue
        try:
            weekdays = parse_weekdays(parts[index])
            lesson_time = parse_clock(parts[index + 1])
        except ValueError as error:
            if slots:
                break
            raise error
        slots.append(RecurringLessonSlot(weekdays=weekdays, lesson_time=lesson_time))
        index += 2
        if index < len(parts) and parts[index] == ";":
            index += 1

    if not slots:
        raise ValueError("Нужно указать хотя бы один день недели и время.")
    if index >= len(parts):
        raise ValueError("Нужно указать дату окончания. Пример: 1 18:00; 3 16:30 31.08")

    until = parse_day(parts[index], today=today)
    duration = positive_int(parts[index + 1], "Длительность") if index + 1 < len(parts) else default_duration
    return slots, until, duration


def next_date_for_weekday(today: date, weekday: int) -> date:
    days_ahead = (weekday - today.isoweekday()) % 7
    return today + timedelta(days=days_ahead)


def stable_schedule_until(student: StudentProfile, today: date) -> date:
    if student.exam_date and student.exam_date >= today:
        return student.exam_date
    return today + timedelta(days=365)


def recurring_time_options(selected_day: date, duration_minutes: int, work_hours: WorkHours) -> list[time]:
    options: list[time] = []
    current = datetime.combine(selected_day, work_hours.starts_at)
    end_of_work = datetime.combine(selected_day, work_hours.ends_at)
    while current + timedelta(minutes=duration_minutes) <= end_of_work:
        if work_hours.contains(current, duration_minutes):
            options.append(current.time())
        current += timedelta(minutes=work_hours.slot_step_minutes)
    return options


def booking_cancel_callback(data: dict[str, Any]) -> str:
    if data.get("actor_role") == Role.ADMIN.value and data.get("booking_source") == "admin_add":
        return "bookback:card"
    return "back:student_menu"


def parse_move_setup(raw: str, today: date, default_duration: int) -> tuple[datetime, int]:
    parts = raw.split()
    if len(parts) < 2:
        raise ValueError("Пример: 20.06 18:00")
    starts_at = parse_start(parts[0], parts[1], today=today)
    duration = positive_int(parts[2], "Длительность") if len(parts) >= 3 else default_duration
    return starts_at, duration


def normalize_contact(message: Message) -> str:
    if message.from_user is None:
        return ""
    if message.from_user.username:
        return f"@{message.from_user.username}"
    return str(message.from_user.id)


def hash_browser_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def webapp_url_bases(settings: Settings) -> list[str]:
    bases = [settings.webapp_url, *(settings.webapp_url_aliases or [])]
    return list(dict.fromkeys(base.rstrip("/") for base in bases if base))


def browser_invite_bases(settings: Settings) -> list[str]:
    bases = webapp_url_bases(settings)
    tunnel_bases = [base for base in bases if "trycloudflare.com" in base]
    if not tunnel_bases:
        return bases
    tunnel_set = set(tunnel_bases)
    return [*tunnel_bases, *(base for base in bases if base not in tunnel_set)]


def format_url_list(urls: list[str]) -> str:
    if len(urls) == 1:
        return urls[0]
    return "\n".join(f"{index}. {url}" for index, url in enumerate(urls, start=1))


def browser_invite_urls(settings: Settings, token: str, *, tutor: bool = False) -> list[str]:
    path = "login/tutor" if tutor else "login"
    return [f"{base}/{path}/{token}" for base in browser_invite_bases(settings)]


def browser_link_keyboard(url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Открыть браузерную версию", url=url)]]
    )


def is_admin(message: Message, settings: Settings) -> bool:
    return bool(message.from_user and message.from_user.id in settings.admin_telegram_ids)


def is_admin_user(user_id: int, settings: Settings) -> bool:
    return user_id in settings.admin_telegram_ids


def is_same_contact(left: str, right: str) -> bool:
    left_norm = left.strip().lower().lstrip("@")
    right_norm = right.strip().lower().lstrip("@")
    return bool(left_norm and right_norm and left_norm == right_norm)


def resolve_account(message: Message, db: SQLiteStorage, settings: Settings) -> UserAccount | None:
    if message.from_user is None:
        return None
    telegram_id = message.from_user.id
    full_name = message.from_user.full_name
    username = message.from_user.username or ""

    if telegram_id in settings.admin_telegram_ids:
        return db.upsert_user(
            UserAccount(
                telegram_id=telegram_id,
                role=Role.ADMIN.value,
                username=username,
                full_name=full_name,
            )
        )

    account = db.get_user(telegram_id)
    if account:
        if account.student_id is not None:
            student = db.get_student(account.student_id)
            if student is None or student.status == StudentStatus.ARCHIVED.value:
                return None
        return account

    contact = normalize_contact(message)
    student = db.find_student_by_contact(contact)
    if student is None:
        return None

    role = Role.PARENT.value if is_same_contact(contact, student.parent_telegram) else Role.STUDENT.value
    return db.upsert_user(
        UserAccount(
            telegram_id=telegram_id,
            role=role,
            student_id=student.id,
            username=username,
            full_name=full_name,
        )
    )


def resolve_callback_account(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> UserAccount | None:
    if callback.from_user.id in settings.admin_telegram_ids:
        return db.upsert_user(
            UserAccount(
                telegram_id=callback.from_user.id,
                role=Role.ADMIN.value,
                username=callback.from_user.username or "",
                full_name=callback.from_user.full_name,
            )
        )
    account = db.get_user(callback.from_user.id)
    if account and account.student_id is not None:
        student = db.get_student(account.student_id)
        if student is None or student.status == StudentStatus.ARCHIVED.value:
            return None
    return account


async def notify_admins(bot: Bot, settings: Settings, text: str, reply_markup: Any = None) -> None:
    for admin_id in settings.admin_telegram_ids:
        try:
            await bot.send_message(admin_id, text, reply_markup=reply_markup)
        except Exception:
            # A blocked chat must not break the user's current action.
            continue


def lesson_request_admin_text(student: StudentProfile, lesson: Lesson) -> str:
    return "\n".join(
        [
            "🗓 Новая заявка на занятие",
            "",
            f"Ученик: {student.full_name}",
            f"Время: {lesson_line(lesson, student)}",
            f"Стоимость: {format_lesson_price_for_duration(student, lesson.duration_minutes)}",
            "",
            "Можно подтвердить или предложить ученику выбрать другое время.",
        ]
    )


def student_lesson_confirmation_text(student: StudentProfile, lesson: Lesson) -> str:
    return "\n".join(
        [
            "Нужно подтвердить занятие:",
            "",
            lesson_public_line(lesson, student),
            "Если время не подходит, нажми «Перенести».",
        ]
    )


async def notify_student_users(
    bot: Bot,
    db: SQLiteStorage,
    student_id: int,
    text: str,
    reply_markup: Any = None,
) -> None:
    for user in db.list_users_by_student(student_id):
        try:
            await bot.send_message(user.telegram_id, text, reply_markup=reply_markup)
        except Exception:
            continue


async def copy_message_to_admins(bot: Bot, settings: Settings, message: Message) -> None:
    if message.from_user is None:
        return
    for admin_id in settings.admin_telegram_ids:
        try:
            await bot.copy_message(
                chat_id=admin_id,
                from_chat_id=message.chat.id,
                message_id=message.message_id,
            )
        except Exception:
            continue


async def send_lesson_calendar_file(
    message: Message,
    lesson: Lesson,
    student: StudentProfile,
    settings: Settings,
) -> None:
    ics = build_lesson_ics(lesson, student, timezone=settings.timezone)
    document = BufferedInputFile(
        ics.encode("utf-8"),
        filename=calendar_filename(lesson, student),
    )
    await message.answer_document(
        document,
        caption="Файл для Apple Calendar. Открой его и нажми «Добавить».",
    )


async def send_state_prompt(
    message: Message,
    state: FSMContext,
    text: str,
    **kwargs: Any,
) -> Message:
    sent = await message.answer(text, **kwargs)
    await state.update_data(prompt_chat_id=sent.chat.id, prompt_message_id=sent.message_id)
    return sent


async def cleanup_state_messages(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    prompt_chat_id = data.get("prompt_chat_id")
    prompt_message_id = data.get("prompt_message_id")
    if prompt_chat_id and prompt_message_id:
        try:
            await message.bot.delete_message(prompt_chat_id, prompt_message_id)
        except Exception:
            pass
    try:
        await message.delete()
    except Exception:
        pass


def file_id_from_message(message: Message) -> str:
    if message.photo:
        return message.photo[-1].file_id
    if message.document:
        return message.document.file_id
    return ""


@router.message(CommandStart())
async def start(message: Message, state: FSMContext, db: SQLiteStorage, settings: Settings) -> None:
    account = resolve_account(message, db, settings)
    if account and account.role == Role.ADMIN.value:
        await message.answer("Админ-панель открыта.", reply_markup=admin_menu(settings.telegram_webapp_url))
        return
    if account and account.student_id:
        student = db.get_student(account.student_id)
        if (
            student
            and account.role == Role.STUDENT.value
            and student.status == StudentStatus.LEAD.value
        ):
            await state.set_state(Questionnaire.answering)
            await state.update_data(
                step=0,
                answers={},
                questionnaire_role="student",
                fields=STUDENT_QUESTIONNAIRE_FIELDS,
            )
            await message.answer("Родитель уже создал заготовку анкеты. Заполни основные данные о себе.")
            await ask_question(message, STUDENT_QUESTIONNAIRE_FIELDS[0], 1, len(STUDENT_QUESTIONNAIRE_FIELDS), state)
            return
        lines = [
            "Добро пожаловать в личный кабинет. Здесь можно посмотреть расписание, ДЗ, оплату и записаться на занятие."
        ]
        if settings.teacher_chat_link:
            lines.append(f"Чат с преподавателем: {settings.teacher_chat_link}")
        await message.answer("\n".join(lines), reply_markup=student_menu(settings.telegram_webapp_url))
        return
    await message.answer(
        "Привет! Основной кабинет теперь в Mini App: расписание, домашка, оплата и запись находятся там.\nНажми «Открыть Mini App» ниже. Анкету в чате оставил только как запасной вариант.",
        reply_markup=first_start_menu(settings.telegram_webapp_url),
    )


@router.message(Command("app"))
@router.message(F.text == "Mini App")
@router.message(F.text == "Открыть Mini App")
async def open_mini_app(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not settings.telegram_webapp_url:
        await message.answer("Mini App URL не настроен.")
        return
    reply_markup = admin_menu(settings.telegram_webapp_url) if is_admin(message, settings) else student_menu(settings.telegram_webapp_url)
    urls = webapp_url_bases(settings) or [settings.telegram_webapp_url]
    await message.answer(
        "Открой Mini App кнопкой ниже.\n"
        "Если VPN или DNS мешает основному домену, попробуй прямые адреса:\n"
        f"{format_url_list(urls)}",
        reply_markup=reply_markup,
    )
    if message.from_user is None:
        return
    account = resolve_account(message, db, settings)
    if account is None:
        return
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + timedelta(days=BROWSER_INVITE_DAYS)
    is_tutor = account.role == Role.ADMIN.value
    if is_tutor:
        db.add_tutor_browser_invite(
            hash_browser_token(token),
            expires_at,
            session_days=BROWSER_SESSION_DAYS,
            created_by=account.telegram_id,
        )
    elif account.student_id is not None:
        db.add_browser_invite(
            hash_browser_token(token),
            account.student_id,
            account.role,
            expires_at,
            session_days=BROWSER_SESSION_DAYS,
            created_by=account.telegram_id,
        )
    else:
        return
    browser_urls = browser_invite_urls(settings, token, tutor=is_tutor)
    primary_url = browser_urls[0] if browser_urls else urls[0]
    await message.answer(
        "Надежный вход без Telegram WebView. Если Mini App зависает на загрузке, открой эту ссылку:",
        reply_markup=browser_link_keyboard(primary_url),
        link_preview_options=LinkPreviewOptions(is_disabled=True),
    )
    await message.answer(format_url_list(browser_urls), link_preview_options=LinkPreviewOptions(is_disabled=True))


@router.message(Command("browser"))
@router.message(F.text == "Браузерная версия")
async def open_browser_version(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not settings.telegram_webapp_url:
        await message.answer("WEBAPP_URL не настроен.")
        return
    if message.from_user is None:
        return

    account = resolve_account(message, db, settings)
    if account is None:
        await message.answer(
            "Я пока не нашел твою карточку. Сначала открой Mini App или заполни анкету.",
            reply_markup=first_start_menu(settings.telegram_webapp_url),
        )
        return

    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + timedelta(days=BROWSER_INVITE_DAYS)
    is_tutor = account.role == Role.ADMIN.value
    if is_tutor:
        db.add_tutor_browser_invite(
            hash_browser_token(token),
            expires_at,
            session_days=BROWSER_SESSION_DAYS,
            created_by=account.telegram_id,
        )
    else:
        if account.student_id is None:
            await message.answer("Карточка не найдена. Открой Mini App или заполни анкету заново.")
            return
        db.add_browser_invite(
            hash_browser_token(token),
            account.student_id,
            account.role,
            expires_at,
            session_days=BROWSER_SESSION_DAYS,
            created_by=account.telegram_id,
        )

    urls = browser_invite_urls(settings, token, tutor=is_tutor)
    primary_url = urls[0] if urls else settings.telegram_webapp_url
    await message.answer(
        "Персональная ссылка для браузера. Она откроет кабинет без Telegram Mini App.\n"
        "Если VPN мешает одному адресу, попробуй следующий из списка.",
        reply_markup=browser_link_keyboard(primary_url),
        link_preview_options=LinkPreviewOptions(is_disabled=True),
    )
    await message.answer(format_url_list(urls), link_preview_options=LinkPreviewOptions(is_disabled=True))


@router.message(Command("help"))
@router.message(F.text == "Помощь")
@router.message(F.text == "Помощь админа")
async def help_message(message: Message, settings: Settings) -> None:
    if not is_admin(message, settings):
        await message.answer(
            "Главное меню внизу: расписание, ближайшее занятие, ДЗ, статистика, чек и запись."
        )
        return
    await message.answer("Меню админа:", reply_markup=admin_help_keyboard())


@router.callback_query(F.data == "back:admin_menu")
async def back_to_admin_menu(callback: CallbackQuery, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    await callback.answer()
    await callback.message.edit_text("Меню админа:", reply_markup=admin_help_keyboard())


@router.callback_query(F.data == "admin_menu:student_tools")
async def admin_student_tools(callback: CallbackQuery, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    await callback.answer()
    await callback.message.edit_text(
        "В карточке ученика есть кнопки:\n"
        "Цена - изменить цены за 60, 90 и 120 минут.\n"
        "Ссылки - добавить доску и Телемост.\n"
        "Выдать ДЗ - отправить домашку.\n"
        "Удалить - убрать ученика из активных.",
        reply_markup=admin_help_keyboard(),
    )


@router.callback_query(F.data == "admin_menu:lesson_tools")
async def admin_lesson_tools(callback: CallbackQuery, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    await callback.answer()
    await callback.message.edit_text(
        "В расписании под каждым днем есть кнопки уроков.\n"
        "Открой урок, чтобы увидеть ученика, оплату, ссылки, ДЗ и кнопки отмены/переноса.",
        reply_markup=admin_help_keyboard(),
    )


@router.message(Command("anketa"))
@router.message(F.text.in_({"Заполнить анкету", "Заполнить анкету в чате"}))
async def start_questionnaire(message: Message, state: FSMContext) -> None:
    await state.set_state(Questionnaire.choosing_role)
    await state.update_data(step=0, answers={})
    await send_state_prompt(
        message,
        state,
        "Привет! Я помогу открыть личный кабинет для занятий.\nКто заходит в бот?",
        reply_markup=role_choice_keyboard(),
    )

@router.message(Command("add_student"))
@router.message(F.text == "Добавить ученика")
async def admin_add_student(message: Message, state: FSMContext, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    await state.set_state(Questionnaire.answering)
    await state.update_data(
        step=0,
        answers={},
        questionnaire_role="admin_student",
        fields=ADMIN_STUDENT_QUESTIONNAIRE_FIELDS,
    )
    await ask_question(
        message,
        ADMIN_STUDENT_QUESTIONNAIRE_FIELDS[0],
        1,
        len(ADMIN_STUDENT_QUESTIONNAIRE_FIELDS),
        state,
    )


@router.callback_query(Questionnaire.choosing_role, F.data.startswith("qrole:"))
async def choose_questionnaire_role(callback: CallbackQuery, state: FSMContext) -> None:
    role = callback.data.split(":", 1)[1]
    fields = PARENT_QUESTIONNAIRE_FIELDS if role == "parent" else STUDENT_QUESTIONNAIRE_FIELDS
    await state.set_state(Questionnaire.answering)
    await state.update_data(step=0, answers={}, questionnaire_role=role, fields=fields)
    await callback.answer()
    try:
        await callback.message.delete()
    except Exception:
        pass
    await ask_question(callback.message, fields[0], 1, len(fields), state)


@router.callback_query(Questionnaire.answering, F.data.startswith("qsubject:"))
async def choose_questionnaire_subject(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    await save_button_answer(callback, state, db, settings, bot, "subject", callback.data.split(":", 1)[1])


@router.callback_query(Questionnaire.answering, F.data.startswith("qprep:"))
async def choose_questionnaire_prep_type(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    await save_button_answer(callback, state, db, settings, bot, "prep_type", callback.data.split(":", 1)[1])


@router.callback_query(Questionnaire.answering, F.data.startswith("qparent_rights:"))
async def choose_parent_rights(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    await save_button_answer(
        callback,
        state,
        db,
        settings,
        bot,
        "parent_can_edit",
        callback.data.split(":", 1)[1],
    )


async def save_button_answer(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
    expected_field: str,
    value: str,
) -> None:
    data = await state.get_data()
    fields = list(data.get("fields", STUDENT_QUESTIONNAIRE_FIELDS))
    step = int(data.get("step", 0))
    if step >= len(fields) or fields[step][0] != expected_field:
        await callback.answer("Сейчас нужен другой ответ", show_alert=True)
        return
    if value == "__other__":
        await callback.answer()
        try:
            await callback.message.delete()
        except Exception:
            pass
        await state.update_data(manual_button_field=expected_field)
        label = "предмет" if expected_field == "subject" else "вид подготовки"
        await send_state_prompt(callback.message, state, f"Напиши свой {label}.")
        return
    answers = dict(data.get("answers", {}))
    answers[expected_field] = value
    await callback.answer()
    try:
        await callback.message.delete()
    except Exception:
        pass
    await continue_questionnaire(callback.message, state, db, settings, bot, fields, step + 1, answers)


@router.message(Questionnaire.answering)
async def questionnaire_answer(
    message: Message,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    if is_admin(message, settings) and await handle_admin_menu_during_state(message, state, db, settings):
        return
    data = await state.get_data()
    fields = list(data.get("fields", STUDENT_QUESTIONNAIRE_FIELDS))
    step = int(data.get("step", 0))
    if step >= len(fields):
        await state.clear()
        return
    field, _ = fields[step]
    if field in BUTTON_FIELDS and data.get("manual_button_field") != field:
        await ask_question(message, fields[step], step + 1, len(fields), state)
        return
    if field == "lesson_price":
        try:
            positive_int(message.text or "", "Стоимость")
        except ValueError:
            await message.answer("Напиши стоимость 60 минут числом, например 1500.")
            return
    if field == "timezone":
        try:
            normalize_timezone(message.text)
        except ValueError as error:
            await message.answer(str(error))
            return
    answers = dict(data.get("answers", {}))
    answers[field] = message.text or ""
    if data.get("manual_button_field") == field:
        await state.update_data(manual_button_field=None)
    await cleanup_state_messages(message, state)

    if (
        data.get("questionnaire_role") == "parent"
        and field == "student_telegram"
        and await try_link_parent_to_existing_student(message, state, db, settings, bot, answers)
    ):
        return

    await continue_questionnaire(message, state, db, settings, bot, fields, step + 1, answers)


async def continue_questionnaire(
    message: Message,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
    fields: list[tuple[str, str]],
    step: int,
    answers: dict[str, str],
) -> None:
    if step < len(fields):
        await state.update_data(step=step, answers=answers)
        await ask_question(message, fields[step], step + 1, len(fields), state)
        return
    await finish_questionnaire(message, state, db, settings, bot, answers)


async def ask_question(
    message: Message,
    field: tuple[str, str],
    number: int,
    total: int,
    state: FSMContext | None = None,
) -> None:
    key, title = field
    text = f"Анкета. Вопрос {number}/{total}:\n{title}"
    sender = send_state_prompt if state else None
    if key == "subject":
        if sender:
            await sender(message, state, text, reply_markup=subject_keyboard())
        else:
            await message.answer(text, reply_markup=subject_keyboard())
    elif key == "prep_type":
        if sender:
            await sender(message, state, text, reply_markup=prep_type_keyboard())
        else:
            await message.answer(text, reply_markup=prep_type_keyboard())
    elif key == "parent_can_edit":
        if sender:
            await sender(message, state, text, reply_markup=parent_rights_keyboard())
        else:
            await message.answer(text, reply_markup=parent_rights_keyboard())
    else:
        if sender:
            await sender(message, state, text)
        else:
            await message.answer(text)


async def try_link_parent_to_existing_student(
    message: Message,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
    answers: dict[str, str],
) -> bool:
    student = db.find_student_by_contact(answers["student_telegram"])
    if student is None or not student.full_name:
        return False
    student.parent_telegram = normalize_contact(message)
    student.parent_name = clean_optional(answers.get("parent_name", ""))
    db.update_student(student)
    db.upsert_user(
        UserAccount(
            telegram_id=message.from_user.id,
            role=Role.PARENT.value,
            student_id=student.id,
            username=message.from_user.username or "",
            full_name=message.from_user.full_name,
        )
    )
    await state.clear()
    lines = ["Готово, я привязал родителя к анкете ученика."]
    if settings.teacher_chat_link:
        lines.append(f"Чат с преподавателем: {settings.teacher_chat_link}")
    await message.answer(
        "\n".join(lines),
        reply_markup=student_menu(settings.telegram_webapp_url),
    )
    await notify_admins(bot, settings, f"Родитель привязан к ученику:\n{student_line(student)}")
    return True


async def finish_questionnaire(
    message: Message,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
    answers: dict[str, str],
) -> None:
    data = await state.get_data()
    questionnaire_role = data.get("questionnaire_role", "student")
    created_by_admin = questionnaire_role == "admin_student"
    contact = normalize_contact(message)
    raw_student_telegram = clean_optional(answers.get("student_telegram", ""))
    raw_parent_telegram = clean_optional(answers.get("parent_telegram", ""))
    parent_can_edit = answers.get("parent_can_edit") == "edit"
    if created_by_admin or questionnaire_role == "parent":
        existing_contact = raw_student_telegram
    else:
        existing_contact = contact
    existing = db.find_student_by_contact(existing_contact) if existing_contact else None
    hour_price = int_or_default(answers.get("lesson_price"), existing.lesson_price if existing else 0)
    progress_goal = infer_progress_goal(answers.get("prep_type", ""), answers.get("subject", ""))
    progress_current = existing.progress_current if existing else 0
    if progress_goal <= 0:
        progress_current = 0
    elif progress_current > progress_goal:
        progress_current = progress_goal

    student = StudentProfile(
        id=existing.id if existing else None,
        full_name=answers.get("full_name", "") or (existing.full_name if existing else f"Ученик {raw_student_telegram}"),
        grade=answers.get("grade", ""),
        prep_type=answers.get("prep_type", ""),
        subject=answers.get("subject", ""),
        goal=answers.get("goal", ""),
        current_level=answers.get("current_level", ""),
        lesson_price=hour_price,
        price_60=hour_price,
        price_90=round(hour_price * 1.5) if hour_price else 0,
        price_120=hour_price * 2 if hour_price else 0,
        lesson_duration_minutes=60,
        lesson_format="онлайн",
        board_url=existing.board_url if existing else "",
        meeting_url=existing.meeting_url if existing else "",
        student_telegram=raw_student_telegram if created_by_admin or questionnaire_role == "parent" else contact,
        parent_telegram=(
            raw_parent_telegram
            if created_by_admin
            else contact if questionnaire_role == "parent" else raw_parent_telegram or (existing.parent_telegram if existing else "")
        ),
        parent_name=clean_optional(answers.get("parent_name", existing.parent_name if existing else "")),
        parent_can_edit=parent_can_edit if questionnaire_role != "parent" else (existing.parent_can_edit if existing else False),
        payer=clean_optional(answers.get("parent_name", "")) if questionnaire_role in {"parent", "admin_student"} else "",
        timezone=normalize_timezone(answers.get("timezone"), existing.timezone if existing else settings.timezone),
        preferred_days_times="",
        start_date=(existing.start_date if existing and existing.start_date else settings.local_today()),
        exam_date=optional_date(answers.get("exam_date"), today=settings.local_today()),
        comment=clean_optional(answers.get("comment", "")),
        status=StudentStatus.LEAD.value if questionnaire_role == "parent" and not answers.get("full_name") else StudentStatus.ACTIVE.value,
        balance_mode=BalanceMode.LESSONS.value,
        balance_lessons=existing.balance_lessons if existing else 0,
        balance_money=existing.balance_money if existing else 0,
        progress_current=progress_current,
        progress_goal=progress_goal,
        prep_plan_text=existing.prep_plan_text if existing else "",
        prep_plan_file_id=existing.prep_plan_file_id if existing else "",
    )
    if existing:
        db.update_student(student)
    else:
        db.add_student(student)
    if not created_by_admin:
        db.upsert_user(
            UserAccount(
                telegram_id=message.from_user.id,
                role=Role.PARENT.value if questionnaire_role == "parent" else Role.STUDENT.value,
                student_id=student.id,
                username=message.from_user.username or "",
                full_name=message.from_user.full_name,
            )
        )
    ensure_exam_tasks(db, student)
    await state.clear()
    if created_by_admin:
        await message.answer(
            await build_student_card_text(db, student, settings),
            reply_markup=student_admin_actions_keyboard(student.id),
        )
        return
    lines = ["Анкета сохранена. Личный кабинет открыт."]
    if questionnaire_role == "parent":
        lines = [
            "Регистрация родителя сохранена.",
            "Когда ребенок запустит бота со своего Telegram, он заполнит основную анкету и получит личный кабинет.",
        ]
    if settings.teacher_chat_link:
        lines.append(f"Чат с преподавателем: {settings.teacher_chat_link}")
    await message.answer(
        "\n".join(lines),
        reply_markup=student_menu(settings.telegram_webapp_url),
    )
    await notify_admins(
        bot,
        settings,
        "\n".join(
            [
                "🆕 Новая регистрация",
                "",
                "Роль: родитель" if questionnaire_role == "parent" else "Роль: ученик",
                student_line(student),
                f"Права родителя: {'редактирование календаря' if student.parent_can_edit else 'просмотр и оплата'}",
            ]
        ),
    )


def int_or_default(raw: str | None, default: int) -> int:
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return default


def positive_int(raw: str, field_name: str) -> int:
    try:
        value = int(raw.strip())
    except ValueError as exc:
        raise ValueError(f"{field_name} должно быть числом.") from exc
    if value <= 0:
        raise ValueError(f"{field_name} должно быть больше нуля.")
    return value


def apply_hour_price(student: StudentProfile, price_60: int) -> None:
    student.price_60 = price_60
    student.price_90 = round(price_60 * 1.5)
    student.price_120 = price_60 * 2
    student.lesson_price = price_60
    student.lesson_duration_minutes = 60


def infer_progress_goal(prep_type: str, subject: str) -> int:
    prep = prep_type.strip().lower()
    subj = subject.strip().lower()
    if "усп" in prep or "school" in prep:
        return 0
    for (prep_key, subject_key), goal in PROGRESS_GOALS.items():
        if prep_key in prep and subject_key in subj:
            return goal
    return 0


def ensure_exam_tasks(db: SQLiteStorage, student: StudentProfile) -> None:
    if student.id is None or student.progress_goal <= 0:
        return
    titles = EGE_INFORMATICS_TOPICS if "информ" in student.subject.lower() else exam_task_titles(student.progress_goal)
    for title in titles:
        if db.find_prep_topic_by_title(student.id, title) is None:
            db.upsert_prep_topic(PrepTopic(student_id=student.id, title=title))


def parse_knowledge_level(raw: str) -> int:
    level = int_or_default(raw, -1)
    if level < 0 or level > 10:
        raise ValueError("Уровень знания должен быть от 0 до 10.")
    return level


def refresh_progress_goal(student: StudentProfile) -> None:
    goal = infer_progress_goal(student.prep_type, student.subject)
    student.progress_goal = goal
    if goal <= 0:
        student.progress_current = 0
    elif student.progress_current > goal:
        student.progress_current = goal


async def handle_admin_menu_during_state(
    message: Message,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
) -> bool:
    text = (message.text or "").strip()
    if text not in {"Ученики", "Расписание", "Добавить ученика", "Должники", "Ожидают оплаты", "Заявки", "Финансы", "Помощь админа"}:
        return False
    if not is_admin(message, settings):
        return False

    await state.clear()
    if text == "Ученики":
        await send_students_menu(message, db)
    elif text == "Расписание":
        await send_schedule_menu(message, db, settings)
    elif text == "Добавить ученика":
        await state.set_state(Questionnaire.answering)
        await state.update_data(
            step=0,
            answers={},
            questionnaire_role="admin_student",
            fields=ADMIN_STUDENT_QUESTIONNAIRE_FIELDS,
        )
        await ask_question(
            message,
            ADMIN_STUDENT_QUESTIONNAIRE_FIELDS[0],
            1,
            len(ADMIN_STUDENT_QUESTIONNAIRE_FIELDS),
            state,
        )
    elif text == "Должники":
        await send_debts_menu(message, db)
    elif text == "Ожидают оплаты":
        await send_pending_payments_menu(message, db)
    elif text == "Заявки":
        await send_lesson_requests_menu(message, db, settings)
    elif text == "Финансы":
        await send_finance_digest(message, db, settings)
    else:
        await message.answer("Меню админа:", reply_markup=admin_help_keyboard())
    return True


def clean_optional(raw: str) -> str:
    raw = raw.strip()
    return "" if raw == "-" else raw


def optional_date(raw: str | None, today: date | None = None) -> date | None:
    raw = clean_optional(raw or "")
    if not raw:
        return None
    try:
        return parse_day(raw, today=today)
    except ValueError:
        return None


@router.message(Command("students"))
@router.message(F.text == "Ученики")
async def students(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    await send_students_menu(message, db)


@router.message(F.text == "Заявки")
async def lesson_requests(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    await send_lesson_requests_menu(message, db, settings)


@router.callback_query(F.data == "admin_menu:lesson_requests")
async def lesson_requests_from_admin_menu(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    await callback.answer()
    await send_lesson_requests_menu(callback.message, db, settings)


@router.message(F.text == "Финансы")
async def finance_digest(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    await send_finance_digest(message, db, settings)


async def send_lesson_requests_menu(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    now = settings.local_now()
    lessons = [
        lesson
        for lesson in db.list_lessons_between(now - timedelta(days=14), now + timedelta(days=30), include_cancelled=False)
        if lesson.status == LessonStatus.PENDING_CONFIRMATION.value
    ]
    if not lessons:
        await message.answer("🗓 Заявок на подтверждение сейчас нет.")
        return
    await message.answer(f"🗓 Заявки на подтверждение: {len(lessons)}")
    for lesson in sorted(lessons, key=lambda item: item.starts_at)[:12]:
        student = db.get_student(lesson.student_id)
        await message.answer(
            "\n".join(
                [
                    "Заявка на занятие",
                    lesson_line(lesson, student, settings.timezone),
                    f"Оплата: {lesson.payment_status}",
                ]
            ),
            reply_markup=lesson_request_actions_keyboard(lesson.id),
        )


async def send_finance_digest(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    now = settings.local_now()
    month_start = datetime(now.year, now.month, 1)
    pending_payments = db.list_pending_payments()
    lessons = db.list_lessons_between(month_start, now + timedelta(days=14), include_cancelled=False)
    unpaid = [
        lesson
        for lesson in lessons
        if lesson.status == LessonStatus.CONDUCTED.value
        and lesson.payment_status in {LessonPaymentStatus.NOT_MARKED.value, LessonPaymentStatus.UNPAID.value}
    ]
    confirmed_lessons = [
        lesson
        for lesson in lessons
        if lesson.status == LessonStatus.CONDUCTED.value
        and lesson.payment_status == LessonPaymentStatus.CONFIRMED.value
    ]
    confirmed_income = 0
    for lesson in confirmed_lessons:
        student = db.get_student(lesson.student_id)
        if student:
            confirmed_income += format_lesson_amount(student, lesson)
    lines = [
        "💳 Финансы",
        "",
        f"Доход по подтвержденным урокам: {confirmed_income} ₽",
        f"Оплат на проверке: {len(pending_payments)}",
        f"Неоплаченных уроков: {len(unpaid)}",
    ]
    await message.answer("\n".join(lines))


def format_lesson_amount(student: StudentProfile, lesson: Lesson) -> int:
    if lesson.payment_amount > 0:
        return lesson.payment_amount
    if lesson.duration_minutes == 90:
        return student.price_90 or round((student.price_60 or student.lesson_price) * 1.5)
    if lesson.duration_minutes == 120:
        return student.price_120 or (student.price_60 or student.lesson_price) * 2
    return student.price_60 or student.lesson_price


async def send_students_menu(message: Message, db: SQLiteStorage) -> None:
    items = db.list_students()
    if not items:
        await message.answer("Учеников пока нет.")
        return
    await message.answer("Выбери ученика:", reply_markup=students_keyboard(items))


@router.callback_query(F.data == "back:students")
async def back_to_students(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    items = db.list_students()
    await callback.answer()
    if not items:
        await callback.message.edit_text("Учеников пока нет.", reply_markup=admin_help_keyboard())
        return
    await callback.message.edit_text("Выбери ученика:", reply_markup=students_keyboard(items))


@router.callback_query(F.data == "admin_menu:students")
async def students_from_admin_menu(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    await callback.answer()
    await send_students_menu(callback.message, db)


async def build_student_card_text(
    db: SQLiteStorage,
    student: StudentProfile,
    settings: Settings,
) -> str:
    lessons = db.list_student_lessons(student.id, limit=50)
    homework = db.get_current_homework(student.id)
    topics = db.list_prep_topics(student.id)
    plan = db.list_plan_items(student.id)
    return format_student_card(
        student,
        lessons,
        homework,
        topics,
        plan,
        now=settings.local_now(),
        teacher_timezone=settings.timezone,
    )


@router.callback_query(F.data.startswith("student:"))
async def student_card_button(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    student = db.get_student(int(callback.data.split(":", 1)[1]))
    if student is None:
        await callback.answer("Ученик не найден", show_alert=True)
        return
    await callback.answer()
    await callback.message.edit_text(
        await build_student_card_text(db, student, settings),
        reply_markup=student_admin_actions_keyboard(student.id),
    )


@router.message(Command("card"))
async def card(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=1)
    if len(parts) < 2:
        await message.answer("Выбери ученика кнопкой в разделе «Ученики».")
        return
    try:
        student_id = positive_int(parts[1], "ID ученика")
    except ValueError as error:
        await message.answer(str(error))
        return
    student = db.get_student(student_id)
    if student is None:
        await message.answer("Ученик не найден.")
        return
    await message.answer(
        await build_student_card_text(db, student, settings),
        reply_markup=student_admin_actions_keyboard(student.id),
    )


@router.callback_query(F.data.startswith("student_delete:"))
async def delete_student_prompt(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    student = db.get_student(int(callback.data.split(":", 1)[1]))
    if student is None:
        await callback.answer("Ученик не найден", show_alert=True)
        return
    await callback.answer()
    await callback.message.edit_text(
        f"Удалить ученика из активных?\n{student_line(student)}\nЗапланированные занятия будут отменены.",
        reply_markup=confirm_delete_student_keyboard(student.id),
    )


@router.callback_query(F.data.startswith("student_delete_yes:"))
async def delete_student_confirm(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    student_id = int(callback.data.split(":", 1)[1])
    student = db.get_student(student_id)
    if student is None:
        await callback.answer("Ученик не найден", show_alert=True)
        return
    db.delete_student(student_id)
    await callback.answer("Удален")
    await callback.message.edit_text(f"Ученик и все его данные удалены:\n{student_line(student)}")


@router.callback_query(F.data.startswith("self_card:"))
async def self_card_callback(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    account = resolve_callback_account(callback, db, settings)
    if not account or not account.student_id:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    student_id = int(callback.data.split(":", 1)[1])
    if student_id != account.student_id:
        await callback.answer("Это не твоя карточка", show_alert=True)
        return
    student = db.get_student(student_id)
    if student is None:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    text = format_student_public_card(student)
    if settings.teacher_chat_link:
        text += f"\nЧат с преподавателем: {settings.teacher_chat_link}"
    await callback.answer()
    await callback.message.edit_text(
        text,
        reply_markup=student_self_actions_keyboard(student.id, allow_delete=account.role == Role.STUDENT.value),
    )


@router.callback_query(F.data.startswith("self_delete:"))
async def self_delete_prompt(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    account = resolve_callback_account(callback, db, settings)
    if not account or not account.student_id:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    if account.role != Role.STUDENT.value:
        await callback.answer("Удалить аккаунт может сам ученик", show_alert=True)
        return
    student_id = int(callback.data.split(":", 1)[1])
    if student_id != account.student_id:
        await callback.answer("Это не твоя карточка", show_alert=True)
        return
    student = db.get_student(student_id)
    if student is None:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    await callback.answer()
    await callback.message.edit_text(
        "Удалить аккаунт и все данные? После этого, чтобы пользоваться ботом, нужно будет заново заполнить анкету.",
        reply_markup=confirm_self_delete_keyboard(student.id),
    )


@router.callback_query(F.data.startswith("self_delete_yes:"))
async def self_delete_confirm(
    callback: CallbackQuery,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    account = resolve_callback_account(callback, db, settings)
    if not account or not account.student_id:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    if account.role != Role.STUDENT.value:
        await callback.answer("Удалить аккаунт может сам ученик", show_alert=True)
        return
    student_id = int(callback.data.split(":", 1)[1])
    if student_id != account.student_id:
        await callback.answer("Это не твоя карточка", show_alert=True)
        return
    student = db.get_student(student_id)
    if student is None:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    db.delete_student(student_id)
    await callback.answer("Аккаунт удален")
    await callback.message.edit_text(
        "Аккаунт и все данные удалены. Чтобы снова пользоваться ботом, заполни анкету заново."
    )
    await notify_admins(bot, settings, f"Ученик удалил аккаунт:\n{student_line(student)}")


@router.callback_query(F.data.startswith("student_edit:"))
async def admin_edit_card_menu(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin_user(callback.from_user.id, settings):
        await callback.answer("Нет доступа", show_alert=True)
        return
    student = db.get_student(int(callback.data.split(":", 1)[1]))
    if student is None:
        await callback.answer("Ученик не найден", show_alert=True)
        return
    await callback.answer()
    await callback.message.edit_text(
        f"Что редактируем?\n{student_line(student)}",
        reply_markup=edit_card_keyboard(student.id, "admin"),
    )


@router.callback_query(F.data.startswith("self_edit:"))
async def self_edit_card_menu(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    account = resolve_callback_account(callback, db, settings)
    if not account or not account.student_id:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    student_id = int(callback.data.split(":", 1)[1])
    if student_id != account.student_id:
        await callback.answer("Это не твоя карточка", show_alert=True)
        return
    student = db.get_student(student_id)
    if student is None:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    await callback.answer()
    await callback.message.edit_text(
        "Что редактируем?",
        reply_markup=edit_card_keyboard(student.id, "self"),
    )


def can_edit_student(callback: CallbackQuery, db: SQLiteStorage, settings: Settings, scope: str, student_id: int, field: str) -> bool:
    if scope == "admin":
        return is_admin_user(callback.from_user.id, settings)
    account = resolve_callback_account(callback, db, settings)
    return bool(account and account.student_id == student_id and field in SELF_EDIT_FIELDS)


@router.callback_query(F.data.startswith("edit_pick:"))
async def edit_pick_callback(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    _, scope, student_id_raw, field = callback.data.split(":", 3)
    student_id = int(student_id_raw)
    if not can_edit_student(callback, db, settings, scope, student_id, field):
        await callback.answer("Нет доступа", show_alert=True)
        return
    await callback.answer()
    await callback.message.edit_text(
        "Выбери значение:",
        reply_markup=edit_choice_keyboard(student_id, scope, field),
    )


@router.callback_query(F.data.startswith("edit_choice:"))
async def edit_choice_callback(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    _, scope, student_id_raw, field, code = callback.data.split(":", 4)
    student_id = int(student_id_raw)
    if not can_edit_student(callback, db, settings, scope, student_id, field):
        await callback.answer("Нет доступа", show_alert=True)
        return
    value = EDIT_CHOICE_VALUES[field][code]
    student = db.get_student(student_id)
    if student is None:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    apply_student_edit(student, field, value)
    db.update_student(student)
    await callback.answer("Сохранено")
    if scope == "admin":
        await callback.message.edit_text(
            await build_student_card_text(db, student, settings),
            reply_markup=student_admin_actions_keyboard(student.id),
        )
    else:
        account = resolve_callback_account(callback, db, settings)
        text = format_student_public_card(student)
        if settings.teacher_chat_link:
            text += f"\nЧат с преподавателем: {settings.teacher_chat_link}"
        await callback.message.edit_text(
            text,
            reply_markup=student_self_actions_keyboard(
                student.id,
                allow_delete=bool(account and account.role == Role.STUDENT.value),
            ),
        )


@router.callback_query(F.data.startswith("edit_field:"))
async def edit_field_callback(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
) -> None:
    _, scope, student_id_raw, field = callback.data.split(":", 3)
    student_id = int(student_id_raw)
    if not can_edit_student(callback, db, settings, scope, student_id, field):
        await callback.answer("Нет доступа", show_alert=True)
        return
    student = db.get_student(student_id)
    if student is None:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    await state.set_state(CardEdit.value)
    await state.update_data(student_id=student_id, field=field, scope=scope)
    await callback.answer()
    await send_state_prompt(
        callback.message,
        state,
        f"Напиши новое значение: {EDIT_FIELD_TITLES.get(field, field)}",
    )


@router.message(CardEdit.value)
async def edit_field_save(message: Message, state: FSMContext, db: SQLiteStorage, settings: Settings) -> None:
    data = await state.get_data()
    student_id = int(data["student_id"])
    field = data["field"]
    scope = data["scope"]
    if scope == "admin":
        if not is_admin(message, settings):
            return
        if await handle_admin_menu_during_state(message, state, db, settings):
            return
    else:
        account = resolve_account(message, db, settings)
        if not account or account.student_id != student_id or field not in SELF_EDIT_FIELDS:
            await state.clear()
            await message.answer("Нет доступа.")
            return
    student = db.get_student(student_id)
    if student is None:
        await state.clear()
        await message.answer("Карточка не найдена.")
        return
    try:
        apply_student_edit(student, field, message.text or "")
    except ValueError as error:
        await message.answer(str(error))
        return
    db.update_student(student)
    if field in {"subject", "prep_type"}:
        ensure_exam_tasks(db, student)
    await cleanup_state_messages(message, state)
    await state.clear()
    if scope == "admin":
        await message.answer(
            await build_student_card_text(db, student, settings),
            reply_markup=student_admin_actions_keyboard(student.id),
        )
    else:
        account = resolve_account(message, db, settings)
        text = format_student_public_card(student)
        if settings.teacher_chat_link:
            text += f"\nЧат с преподавателем: {settings.teacher_chat_link}"
        await message.answer(
            text,
            reply_markup=student_self_actions_keyboard(
                student.id,
                allow_delete=bool(account and account.role == Role.STUDENT.value),
            ),
        )


def apply_student_edit(student: StudentProfile, field: str, raw_value: str) -> None:
    value = clean_optional(raw_value)
    if field == "lesson_price":
        try:
            price_60 = positive_int(value, "Стоимость")
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        apply_hour_price(student, price_60)
        return
    if field == "exam_date":
        student.exam_date = optional_date(value)
        return
    if field == "timezone":
        student.timezone = normalize_timezone(value)
        return
    if field in {
        "full_name",
        "grade",
        "subject",
        "prep_type",
        "goal",
        "current_level",
        "student_telegram",
        "parent_telegram",
        "parent_name",
        "board_url",
        "meeting_url",
        "comment",
    }:
        setattr(student, field, value)
        if field in {"subject", "prep_type"}:
            refresh_progress_goal(student)
        return
    if field == "progress":
        if infer_progress_goal(student.prep_type, student.subject) <= 0:
            raise ValueError("Для успеваемости прогресс не используется.")
        current, goal = parse_progress(value)
        student.progress_current = current
        student.progress_goal = goal
        return
    raise ValueError("Это поле нельзя редактировать.")


def parse_progress(raw_value: str) -> tuple[int, int]:
    parts = [
        part.strip()
        for part in raw_value.replace("/", " ").replace(",", " ").split()
        if part.strip()
    ]
    if len(parts) != 2:
        raise ValueError("Нужно два числа: текущий прогресс и цель. Например: 2/15.")
    try:
        current, goal = (int(part) for part in parts)
    except ValueError as exc:
        raise ValueError("Прогресс должен состоять из чисел. Например: 2/15.") from exc
    if current < 0:
        raise ValueError("Текущий прогресс не может быть отрицательным.")
    if goal <= 0:
        raise ValueError("Цель должна быть больше нуля.")
    if current > goal:
        raise ValueError("Текущий прогресс не может быть больше цели.")
    return current, goal


@router.callback_query(F.data.startswith("student_price:"))
async def student_price_prompt(callback: CallbackQuery, state: FSMContext, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    student = db.get_student(int(callback.data.split(":", 1)[1]))
    if student is None:
        await callback.answer("Ученик не найден", show_alert=True)
        return
    await state.set_state(AdminEdit.price)
    await state.update_data(student_id=student.id)
    await callback.answer()
    await send_state_prompt(
        callback.message,
        state,
        f"Напиши стоимость 60 минут для {student.full_name} числом.\n"
        "90 и 120 минут посчитаются автоматически.",
    )


@router.message(AdminEdit.price)
async def student_price_save(message: Message, state: FSMContext, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    if await handle_admin_menu_during_state(message, state, db, settings):
        return
    data = await state.get_data()
    student = db.get_student(int(data["student_id"]))
    if student is None:
        await state.clear()
        await message.answer("Ученик не найден.")
        return
    try:
        price_60 = positive_int(message.text or "", "Стоимость")
    except ValueError as error:
        await message.answer(str(error))
        return
    apply_hour_price(student, price_60)
    db.update_student(student)
    await cleanup_state_messages(message, state)
    await state.clear()
    await message.answer(
        f"Цены сохранены:\n{student_line(student)}",
        reply_markup=student_admin_actions_keyboard(student.id),
    )


@router.callback_query(F.data.startswith("student_links:"))
async def student_links_prompt(callback: CallbackQuery, state: FSMContext, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    student = db.get_student(int(callback.data.split(":", 1)[1]))
    if student is None:
        await callback.answer("Ученик не найден", show_alert=True)
        return
    await state.set_state(AdminEdit.links)
    await state.update_data(student_id=student.id)
    await callback.answer()
    await send_state_prompt(
        callback.message,
        state,
        f"Отправь для {student.full_name} две ссылки одним сообщением:\n"
        "1 строка - доска\n2 строка - Телемост",
    )


@router.message(AdminEdit.links)
async def student_links_save(message: Message, state: FSMContext, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    if await handle_admin_menu_during_state(message, state, db, settings):
        return
    data = await state.get_data()
    student = db.get_student(int(data["student_id"]))
    if student is None:
        await state.clear()
        await message.answer("Ученик не найден.")
        return
    parts = [part.strip() for part in (message.text or "").replace("\n", " ").split() if part.strip()]
    if len(parts) < 2:
        await message.answer("Нужно две ссылки: доска и Телемост.")
        return
    student.board_url = parts[0]
    student.meeting_url = parts[1]
    db.update_student(student)
    await cleanup_state_messages(message, state)
    await state.clear()
    await message.answer(
        f"Ссылки сохранены:\n{student_line(student)}",
        reply_markup=student_admin_actions_keyboard(student.id),
    )


@router.callback_query(F.data.startswith("student_hw:"))
async def student_homework_prompt(callback: CallbackQuery, state: FSMContext, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    student = db.get_student(int(callback.data.split(":", 1)[1]))
    if student is None:
        await callback.answer("Ученик не найден", show_alert=True)
        return
    await state.set_state(AdminEdit.homework)
    await state.update_data(student_id=student.id)
    await callback.answer()
    await send_state_prompt(callback.message, state, f"Напиши текст ДЗ для {student.full_name}.")


@router.message(AdminEdit.homework)
async def student_homework_save(
    message: Message,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    if not is_admin(message, settings):
        return
    if await handle_admin_menu_during_state(message, state, db, settings):
        return
    data = await state.get_data()
    student = db.get_student(int(data["student_id"]))
    if student is None:
        await state.clear()
        await message.answer("Ученик не найден.")
        return
    item = assign_homework(db, student.id, message.text or "")
    await cleanup_state_messages(message, state)
    await state.clear()
    await message.answer(
        f"ДЗ выдано: #{item.id}",
        reply_markup=student_admin_actions_keyboard(student.id),
    )
    await notify_student_users(bot, db, student.id, f"Новое домашнее задание:\n{homework_line(item)}")


@router.callback_query(F.data.startswith("student_regular:"))
async def admin_regular_schedule_prompt(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    student = db.get_student(int(callback.data.split(":", 1)[1]))
    if student is None:
        await callback.answer("Ученик не найден", show_alert=True)
        return
    await state.set_state(RegularScheduleFlow.choosing_weekday)
    await state.update_data(student_id=student.id, actor_role=Role.ADMIN.value)
    await callback.answer()
    await callback.message.edit_text(
        f"Стабильное расписание для {student.full_name}.\n"
        f"Длительность: {student.lesson_duration_minutes} мин.\n"
        "Выбери день недели:",
        reply_markup=recurring_weekdays_keyboard("stableback:card"),
    )


@router.callback_query(F.data.startswith("student_add_lesson:"))
async def admin_add_lesson_prompt(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    student = db.get_student(int(callback.data.split(":", 1)[1]))
    if student is None:
        await callback.answer("Ученик не найден", show_alert=True)
        return
    await state.set_state(Booking.choosing_duration)
    await state.update_data(student_id=student.id, actor_role=Role.ADMIN.value, booking_source="admin_add")
    await callback.answer()
    await callback.message.edit_text(
        f"Разовое занятие для {student.full_name}.\nВыбери продолжительность:",
        reply_markup=duration_keyboard(student, "bookback:card"),
    )


@router.message(Command("regular"))
@router.message(F.text == "Регулярное расписание")
async def regular_schedule_prompt(
    message: Message,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await message.answer("Карточка не найдена.")
        return
    student = db.get_student(account.student_id)
    if student is None:
        await message.answer("Карточка не найдена.")
        return
    await state.set_state(RegularScheduleFlow.choosing_weekday)
    await state.update_data(student_id=student.id, actor_role=account.role)
    await message.answer(
        f"Стабильное расписание.\n"
        f"Длительность: {student.lesson_duration_minutes} мин.\n"
        "Выбери день недели:",
        reply_markup=recurring_weekdays_keyboard("stableback:card"),
    )


@router.callback_query(RegularScheduleFlow.choosing_weekday, F.data == "stableback:card")
async def regular_schedule_back_to_card(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
) -> None:
    data = await state.get_data()
    student = db.get_student(int(data["student_id"]))
    await state.clear()
    if student is None:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    await callback.answer()
    if data.get("actor_role") == Role.ADMIN.value:
        await callback.message.edit_text(
            await build_student_card_text(db, student, settings),
            reply_markup=student_admin_actions_keyboard(student.id),
        )
    else:
        await callback.message.edit_text(
            format_student_public_card(student),
            reply_markup=student_self_actions_keyboard(student.id),
        )


@router.callback_query(RegularScheduleFlow.choosing_weekday, F.data.startswith("stableday:"))
async def regular_schedule_weekday(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
    work_hours: WorkHours,
) -> None:
    data = await state.get_data()
    student = db.get_student(int(data["student_id"]))
    if student is None:
        await state.clear()
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    weekday = int(callback.data.split(":", 1)[1])
    selected_day = next_date_for_weekday(settings.local_today(), weekday)
    options = recurring_time_options(selected_day, student.lesson_duration_minutes, work_hours)
    if not options:
        await callback.answer("В этот день нет рабочих слотов", show_alert=True)
        return
    await state.set_state(RegularScheduleFlow.choosing_time)
    await state.update_data(weekday=weekday)
    await callback.answer()
    await callback.message.edit_text(
        "Выбери время стабильного занятия:",
        reply_markup=recurring_times_keyboard(options, "stableback:weekday"),
    )


@router.callback_query(RegularScheduleFlow.choosing_time, F.data == "stableback:weekday")
async def regular_schedule_back_to_weekday(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
) -> None:
    data = await state.get_data()
    student = db.get_student(int(data["student_id"]))
    if student is None:
        await state.clear()
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    await state.set_state(RegularScheduleFlow.choosing_weekday)
    await callback.answer()
    await callback.message.edit_text(
        f"Стабильное расписание.\n"
        f"Длительность: {student.lesson_duration_minutes} мин.\n"
        "Выбери день недели:",
        reply_markup=recurring_weekdays_keyboard("stableback:card"),
    )


@router.callback_query(RegularScheduleFlow.choosing_time, F.data.startswith("stabletime:"))
async def regular_schedule_time(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
    work_hours: WorkHours,
    bot: Bot,
) -> None:
    data = await state.get_data()
    student = db.get_student(int(data["student_id"]))
    if student is None:
        await state.clear()
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    weekday = int(data["weekday"])
    lesson_time = parse_clock(callback.data.split(":", 1)[1])
    until = stable_schedule_until(student, settings.local_today())
    result = create_recurring_lessons_for_slots(
        storage=db,
        student_id=student.id,
        from_date=settings.local_today(),
        until=until,
        slots=[RecurringLessonSlot(weekdays={weekday}, lesson_time=lesson_time)],
        duration_minutes=student.lesson_duration_minutes,
        work_hours=work_hours,
    )
    await state.clear()
    until_note = day_label(student.exam_date) if student.exam_date else "на год вперед"
    text = (
        f"Стабильное расписание добавлено: {lesson_time.strftime('%H:%M')}.\n"
        f"Период: до {until_note}.\n"
        f"Создано занятий: {len(result.created)}\n"
        f"Пропущено из-за конфликтов: {len(result.skipped)}"
    )
    await callback.answer("Стабильное расписание добавлено")
    await callback.message.edit_text(text)
    if data.get("actor_role") == Role.ADMIN.value:
        for lesson in result.created:
            lesson.status = LessonStatus.PENDING_CONFIRMATION.value
            db.update_lesson(lesson)
        await notify_student_users(
            bot,
            db,
            student.id,
            student_lesson_confirmation_text(student, result.created[0]) if result.created else text,
            reply_markup=student_lesson_confirmation_keyboard(result.created[0].id) if result.created else None,
        )
    else:
        await notify_admins(
            bot,
            settings,
            f"{student.full_name} создал стабильное расписание:\n{text}",
        )


async def clear_student_stable_schedule(
    db: SQLiteStorage,
    student: StudentProfile,
    actor_role: str,
    settings: Settings,
) -> tuple[int, str]:
    cleared_count = clear_future_stable_lessons(
        db,
        student.id,
        settings.local_now(),
        actor_role,
    )
    text = (
        f"Стабильное расписание очищено.\n"
        f"Удалено будущих стабильных занятий: {cleared_count}"
    )
    return cleared_count, text


@router.callback_query(F.data.startswith("student_clear_regular:"))
async def admin_clear_regular_schedule(
    callback: CallbackQuery,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    student = db.get_student(int(callback.data.split(":", 1)[1]))
    if student is None:
        await callback.answer("Ученик не найден", show_alert=True)
        return
    _, text = await clear_student_stable_schedule(db, student, Role.ADMIN.value, settings)
    await callback.answer("Готово")
    await callback.message.edit_text(
        f"{text}\n\n{await build_student_card_text(db, student, settings)}",
        reply_markup=student_admin_actions_keyboard(student.id),
    )
    await notify_student_users(bot, db, student.id, text)


@router.callback_query(F.data.startswith("self_clear_regular:"))
async def self_clear_regular_schedule(
    callback: CallbackQuery,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    account = resolve_callback_account(callback, db, settings)
    if not account or account.student_id != int(callback.data.split(":", 1)[1]):
        await callback.answer("Нет доступа", show_alert=True)
        return
    student = db.get_student(account.student_id)
    if student is None:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    _, text = await clear_student_stable_schedule(db, student, account.role, settings)
    await callback.answer("Готово")
    await callback.message.edit_text(text, reply_markup=student_self_actions_keyboard(student.id))
    await notify_admins(bot, settings, f"{student.full_name} очистил стабильное расписание.\n{text}")


@router.message(Command("clear_regular"))
@router.message(F.text == "Очистить стабильное расписание")
async def clear_regular_schedule_command(
    message: Message,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    if is_admin(message, settings):
        parts = (message.text or "").split(maxsplit=1)
        if len(parts) < 2:
            await message.answer("Для админа: /clear_regular ID ученика")
            return
        try:
            student_id = positive_int(parts[1], "ID ученика")
        except ValueError as error:
            await message.answer(str(error))
            return
        student = db.get_student(student_id)
        if student is None:
            await message.answer("Ученик не найден.")
            return
        _, text = await clear_student_stable_schedule(db, student, Role.ADMIN.value, settings)
        await message.answer(text, reply_markup=student_admin_actions_keyboard(student.id))
        await notify_student_users(bot, db, student.id, text)
        return

    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await message.answer("Карточка не найдена.")
        return
    student = db.get_student(account.student_id)
    if student is None:
        await message.answer("Карточка не найдена.")
        return
    _, text = await clear_student_stable_schedule(db, student, account.role, settings)
    await message.answer(text)
    await notify_admins(bot, settings, f"{student.full_name} очистил стабильное расписание.\n{text}")


@router.message(Command("links"))
async def update_links(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=3)
    if len(parts) < 4:
        await message.answer("Открой ученика кнопкой и нажми «Ссылки».")
        return
    try:
        student_id = positive_int(parts[1], "ID ученика")
    except ValueError as error:
        await message.answer(str(error))
        return
    student = db.get_student(student_id)
    if student is None:
        await message.answer("Ученик не найден.")
        return
    student.board_url = parts[2]
    student.meeting_url = parts[3]
    db.update_student(student)
    await message.answer(f"Ссылки сохранены:\n{student_line(student)}")


@router.message(Command("price"))
async def update_price(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=2)
    if len(parts) < 3:
        await message.answer("Открой ученика кнопкой и нажми «Цена».")
        return
    try:
        student_id = positive_int(parts[1], "ID ученика")
    except ValueError as error:
        await message.answer(str(error))
        return
    student = db.get_student(student_id)
    if student is None:
        await message.answer("Ученик не найден.")
        return
    try:
        price_60 = positive_int(parts[2], "Стоимость")
    except ValueError as error:
        await message.answer(str(error))
        return
    apply_hour_price(student, price_60)
    db.update_student(student)
    await message.answer(f"Цены сохранены:\n{student_line(student)}")


@router.message(Command("schedule"))
@router.message(F.text == "Расписание")
async def schedule(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    await send_schedule_menu(message, db, settings)


async def send_schedule_menu(
    message: Message,
    db: SQLiteStorage,
    settings: Settings,
    start_offset: int = 0,
) -> None:
    today = settings.local_today()
    now = settings.local_now()
    for offset in range(start_offset, start_offset + 7):
        day = today + timedelta(days=offset)
        day_start = datetime.combine(day, time.min)
        day_end = day_start + timedelta(days=1)
        lessons = [
            lesson
            for lesson in db.list_lessons_between(day_start, day_end, include_cancelled=False)
            if lesson.status == LessonStatus.PLANNED.value and lesson.starts_at >= now
        ]
        items = [(lesson, db.get_student(lesson.student_id)) for lesson in lessons]
        items = [(lesson, student) for lesson, student in items if student is not None]
        names = " ".join(student.full_name.split()[0] for _, student in items) or "занятий нет"
        text = f"{day.strftime('%d.%m')}: {names}"
        if items:
            await message.answer(text, reply_markup=admin_schedule_day_keyboard(items))
        else:
            await message.answer(text)
    await message.answer("Период расписания:", reply_markup=schedule_week_keyboard(start_offset))


@router.callback_query(F.data == "admin_menu:schedule")
async def schedule_from_admin_menu(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    await callback.answer()
    await send_schedule_menu(callback.message, db, settings)


@router.callback_query(F.data == "back:schedule")
async def back_to_schedule(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    await callback.answer()
    await callback.message.edit_text("Открываю расписание...")
    await send_schedule_menu(callback.message, db, settings)


@router.callback_query(F.data.startswith("schedule_week:"))
async def schedule_week_callback(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    start_offset = int(callback.data.split(":", 1)[1])
    await callback.answer()
    await send_schedule_menu(callback.message, db, settings, start_offset=start_offset)


@router.callback_query(F.data.startswith("lesson:"))
async def admin_lesson_details(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    lesson_id = int(callback.data.split(":", 1)[1])
    lesson = db.get_lesson(lesson_id)
    if lesson is None:
        await callback.answer("Занятие не найдено", show_alert=True)
        return
    student = db.get_student(lesson.student_id)
    if student is None:
        await callback.answer("Ученик не найден", show_alert=True)
        return
    homework = db.get_current_homework(student.id)
    text = "\n".join(
        [
            escape(lesson_line(lesson, student)),
            f"Чат: {student_chat_html(student)}",
            f"Телемост: {escape(student.meeting_url) if student.meeting_url else 'не указан'}",
            f"Доска: {escape(student.board_url) if student.board_url else 'не указана'}",
            f"ДЗ: {homework.status if homework else 'нет'}",
            f"Заметки: {escape(student.comment) if student.comment else 'нет'}",
        ]
    )
    await callback.answer()
    await callback.message.edit_text(
        text,
        reply_markup=admin_lesson_actions_keyboard(lesson.id),
        parse_mode="HTML",
        link_preview_options=LinkPreviewOptions(is_disabled=True),
    )


@router.callback_query(F.data.startswith("calendar:"))
async def lesson_calendar_callback(
    callback: CallbackQuery,
    db: SQLiteStorage,
    settings: Settings,
) -> None:
    lesson_id = int(callback.data.split(":", 1)[1])
    lesson = db.get_lesson(lesson_id)
    if lesson is None:
        await callback.answer("Занятие не найдено", show_alert=True)
        return
    account = resolve_callback_account(callback, db, settings)
    if not account:
        await callback.answer("Нет доступа", show_alert=True)
        return
    if account.role != Role.ADMIN.value and account.student_id != lesson.student_id:
        await callback.answer("Нет доступа", show_alert=True)
        return
    student = db.get_student(lesson.student_id)
    if student is None:
        await callback.answer("Ученик не найден", show_alert=True)
        return
    await callback.answer("Готовлю календарь")
    await send_lesson_calendar_file(callback.message, lesson, student, settings)


def can_access_lesson(account: UserAccount, lesson: Lesson) -> bool:
    return account.role == Role.ADMIN.value or account.student_id == lesson.student_id


@router.callback_query(F.data.startswith("move_lesson:"))
async def move_lesson_prompt(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
) -> None:
    lesson = db.get_lesson(int(callback.data.split(":", 1)[1]))
    if lesson is None:
        await callback.answer("Занятие не найдено", show_alert=True)
        return
    account = resolve_callback_account(callback, db, settings)
    if not account or not can_access_lesson(account, lesson):
        await callback.answer("Нет доступа", show_alert=True)
        return
    await state.set_state(MoveLessonFlow.setup)
    await state.update_data(lesson_id=lesson.id, actor_role=account.role)
    await callback.answer()
    await send_state_prompt(
        callback.message,
        state,
        "Напиши новую дату и время:\n"
        "ДД.ММ ЧЧ:ММ [длительность]\n"
        "Например: 20.06 18:00",
    )


@router.message(Command("move"))
@router.message(F.text == "Перенести занятие")
async def move_lesson_from_menu(
    message: Message,
    db: SQLiteStorage,
    settings: Settings,
) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await message.answer("Карточка не найдена.")
        return
    lessons = [
        lesson
        for lesson in db.list_student_lessons(account.student_id, limit=20)
        if lesson.status == LessonStatus.PLANNED.value and lesson.starts_at >= settings.local_now()
    ]
    if not lessons:
        await message.answer("Запланированных занятий нет.")
        return
    student = db.get_student(account.student_id)
    for lesson in sorted(lessons, key=lambda item: item.starts_at):
        await message.answer(
            lesson_public_line(lesson, student),
            reply_markup=student_lesson_actions_keyboard(lesson.id),
        )


@router.message(MoveLessonFlow.setup)
async def move_lesson_save(
    message: Message,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
    work_hours: WorkHours,
    bot: Bot,
) -> None:
    data = await state.get_data()
    lesson = db.get_lesson(int(data["lesson_id"]))
    if lesson is None:
        await cleanup_state_messages(message, state)
        await state.clear()
        await message.answer("Занятие не найдено.")
        return
    student = db.get_student(lesson.student_id)
    if student is None:
        await cleanup_state_messages(message, state)
        await state.clear()
        await message.answer("Ученик не найден.")
        return
    try:
        starts_at, duration = parse_move_setup(
            message.text or "",
            today=settings.local_today(),
            default_duration=lesson.duration_minutes,
        )
        moved = move_lesson(db, lesson.id, starts_at, duration, work_hours)
    except SlotUnavailableError as error:
        await message.answer("Не могу перенести:\n" + "\n".join(c.message for c in error.conflicts))
        return
    except ValueError as error:
        await message.answer(str(error))
        return
    await cleanup_state_messages(message, state)
    await state.clear()
    admin_text = f"Занятие перенесено:\n{lesson_line(moved, student)}"
    student_text = f"Занятие перенесено:\n{lesson_public_line(moved, student)}"
    text = admin_text if data.get("actor_role") == Role.ADMIN.value else student_text
    await message.answer(text, reply_markup=lesson_calendar_keyboard(moved.id))
    if data.get("actor_role") == Role.ADMIN.value:
        await notify_student_users(
            bot,
            db,
            student.id,
            student_text,
            reply_markup=lesson_calendar_keyboard(moved.id),
        )
    else:
        await notify_admins(
            bot,
            settings,
            f"{student.full_name} перенес занятие:\n{lesson_line(moved, student)}",
            reply_markup=lesson_calendar_keyboard(moved.id),
        )


@router.callback_query(F.data.startswith("admin_cancel:"))
async def admin_cancel_lesson_button(
    callback: CallbackQuery,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    lesson = cancel_lesson(db, int(callback.data.split(":", 1)[1]), Role.ADMIN.value)
    student = db.get_student(lesson.student_id)
    await callback.answer("Отменено")
    await callback.message.edit_text(f"Занятие отменено:\n{lesson_line(lesson, student)}")
    await notify_student_users(
        bot,
        db,
        lesson.student_id,
        f"Преподаватель отменил занятие:\n{lesson_public_line(lesson, student)}",
    )


@router.callback_query(F.data.startswith("admin_delete_lesson:"))
async def admin_delete_lesson_button(
    callback: CallbackQuery,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    lesson = db.get_lesson(int(callback.data.split(":", 1)[1]))
    if lesson is None:
        await callback.answer("Занятие уже удалено", show_alert=True)
        return
    student = db.get_student(lesson.student_id)
    db.delete_lesson(lesson.id)
    await callback.answer("Удалено")
    await callback.message.edit_text("Занятие удалено из календаря.")
    if student is not None:
        await notify_student_users(
            bot,
            db,
            student.id,
            f"Преподаватель удалил занятие:\n{lesson_public_line(lesson, student)}",
        )


@router.callback_query(F.data.startswith("ask_move:"))
async def ask_move_lesson_button(
    callback: CallbackQuery,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    lesson = db.get_lesson(int(callback.data.split(":", 1)[1]))
    if lesson is None:
        await callback.answer("Занятие не найдено", show_alert=True)
        return
    student = db.get_student(lesson.student_id)
    await notify_student_users(
        bot,
        db,
        lesson.student_id,
        f"Преподаватель просит перенести занятие:\n{lesson_public_line(lesson, student)}",
    )
    await callback.answer("Запрос отправлен")


@router.message(Command("add_lesson"))
async def add_lesson(
    message: Message,
    db: SQLiteStorage,
    settings: Settings,
    work_hours: WorkHours,
    bot: Bot,
) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=5)
    if len(parts) < 4:
        await message.answer("Разовые занятия сейчас лучше добавлять через кнопочную запись ученика.")
        return
    try:
        student_id = positive_int(parts[1], "ID ученика")
        duration = positive_int(parts[4], "Длительность") if len(parts) >= 5 else 0
    except ValueError as error:
        await message.answer(str(error))
        return
    student = db.get_student(student_id)
    if student is None:
        await message.answer("Ученик не найден.")
        return
    duration = duration or student.lesson_duration_minutes
    try:
        lesson = add_single_lesson(
            db,
            student_id,
            parse_start(parts[2], parts[3], today=settings.local_today()),
            duration,
            work_hours,
        )
    except SlotUnavailableError as error:
        await message.answer("Не могу создать занятие:\n" + "\n".join(c.message for c in error.conflicts))
        return
    except ValueError:
        await message.answer("Не понял дату или время. Пример: /add_lesson 1 20.11 15:00 90")
        return
    lesson.status = LessonStatus.PENDING_CONFIRMATION.value
    db.update_lesson(lesson)
    await message.answer(
        f"Занятие создано и отправлено ученику на подтверждение:\n{lesson_line(lesson, student)}",
        reply_markup=lesson_calendar_keyboard(lesson.id),
    )
    await notify_student_users(
        bot,
        db,
        student_id,
        student_lesson_confirmation_text(student, lesson),
        reply_markup=student_lesson_confirmation_keyboard(lesson.id),
    )


@router.message(Command("stable"))
async def stable_schedule(
    message: Message,
    db: SQLiteStorage,
    settings: Settings,
    work_hours: WorkHours,
) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=6)
    if len(parts) < 6:
        await message.answer("Стабильное расписание пока оставил как служебный текстовый сценарий.")
        return
    try:
        student_id = positive_int(parts[1], "ID ученика")
        weekdays = {positive_int(item, "День недели") for item in parts[4].split(",") if item}
        duration = positive_int(parts[6], "Длительность") if len(parts) >= 7 else 0
    except ValueError as error:
        await message.answer(str(error))
        return
    student = db.get_student(student_id)
    if student is None:
        await message.answer("Ученик не найден.")
        return
    duration = duration or student.lesson_duration_minutes
    try:
        result = create_recurring_lessons(
            storage=db,
            student_id=student_id,
            from_date=parse_day(parts[2], today=settings.local_today()),
            until=parse_day(parts[3], today=settings.local_today()),
            weekdays=weekdays,
            lesson_time=parse_clock(parts[5]),
            duration_minutes=duration,
            work_hours=work_hours,
        )
    except ValueError as error:
        await message.answer(f"Не могу создать стабильное расписание: {error}")
        return
    await message.answer(
        f"Создано занятий: {len(result.created)}\n"
        f"Пропущено из-за конфликтов: {len(result.skipped)}"
    )


@router.message(Command("close"))
async def close_slot(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=4)
    if len(parts) < 4:
        await message.answer(
            "Команда закрывает свободное окно на любую дату:\n"
            "/close ДД.ММ начало конец причина\n"
            "Например: /close 20.11 15:00 17:00 личные дела\n"
            "Можно указать год: /close 20.11.2026 15:00 17:00"
        )
        return
    try:
        starts_at = parse_start(parts[1], parts[2], today=settings.local_today())
        ends_at = parse_start(parts[1], parts[3], today=settings.local_today())
    except ValueError:
        await message.answer("Не понял дату или время. Пример: /close 20.11 15:00 17:00 личные дела")
        return
    if ends_at <= starts_at:
        await message.answer("Время конца должно быть позже времени начала.")
        return
    reason = parts[4] if len(parts) >= 5 else ""
    slot = db.add_closed_slot(
        ClosedSlot(
            starts_at=starts_at,
            ends_at=ends_at,
            reason=reason,
        )
    )
    await message.answer(f"Слот закрыт: #{slot.id}\n{ru_dt(slot.starts_at)} - {slot.ends_at.strftime('%H:%M')}")


@router.message(Command("close_day"))
async def close_day(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=2)
    if len(parts) < 2:
        await message.answer(
            "Команда закрывает весь день на любую дату:\n"
            "/close_day ДД.ММ причина\n"
            "Можно указать год: /close_day 20.11.2026"
        )
        return
    try:
        day = parse_day(parts[1], today=settings.local_today())
    except ValueError:
        await message.answer("Не понял дату. Пример: /close_day 20.11 личные дела")
        return
    reason = parts[2] if len(parts) >= 3 else "закрытый день"
    db.add_closed_slot(
        ClosedSlot(
            starts_at=datetime.combine(day, time.min),
            ends_at=datetime.combine(day + timedelta(days=1), time.min),
            reason=reason,
        )
    )
    await message.answer(f"День закрыт для записи: {day_label(day)}")


@router.message(Command("cancel_lesson"))
async def admin_cancel_lesson(
    message: Message,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=2)
    if len(parts) < 2:
        await message.answer("Открой занятие через расписание и нажми «Отменить».")
        return
    try:
        lesson_id = positive_int(parts[1], "ID занятия")
        lesson = cancel_lesson(db, lesson_id, Role.ADMIN.value, parts[2] if len(parts) >= 3 else "")
    except ValueError as error:
        await message.answer(str(error))
        return
    student = db.get_student(lesson.student_id)
    await message.answer(f"Занятие отменено:\n{lesson_line(lesson, student)}")
    await notify_student_users(
        bot,
        db,
        lesson.student_id,
        f"Преподаватель отменил занятие:\n{lesson_public_line(lesson, student)}",
    )


@router.message(Command("conducted"))
async def conducted(
    message: Message,
    db: SQLiteStorage,
    settings: Settings,
    google_sheets_reporter: GoogleSheetsReporter,
) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=2)
    if len(parts) < 2:
        await message.answer("Открой занятие через расписание.")
        return
    try:
        result = mark_lesson_conducted(
            db,
            positive_int(parts[1], "ID занятия"),
            topic=parts[2] if len(parts) >= 3 else "",
            low_balance_threshold=settings.low_balance_threshold,
        )
    except ValueError as error:
        await message.answer(str(error))
        return
    sheets_note = ""
    if settings.google_sheets_enabled:
        try:
            synced_count = google_sheets_reporter.sync_conducted_lessons(db)
            sheets_note = f"\nGoogle Sheets обновлены: {synced_count} уроков."
        except Exception:
            sheets_note = "\nНе удалось обновить Google Sheets. Урок сохранен в боте."
    await message.answer(f"Занятие проведено:\n{lesson_line(result.lesson, result.student)}{sheets_note}")


@router.message(Command("sync_sheets"))
async def sync_sheets(
    message: Message,
    db: SQLiteStorage,
    settings: Settings,
    google_sheets_reporter: GoogleSheetsReporter,
) -> None:
    if not is_admin(message, settings):
        return
    if not settings.google_sheets_enabled:
        await message.answer("Google Sheets не настроены в .env.")
        return
    try:
        synced_count = google_sheets_reporter.sync_conducted_lessons(db)
    except Exception:
        await message.answer("Не удалось обновить Google Sheets. Проверь доступы и ID таблицы.")
        return
    await message.answer(f"Google Sheets обновлены: {synced_count} проведенных уроков.")


@router.message(Command("homework"))
async def homework(message: Message, db: SQLiteStorage, settings: Settings, bot: Bot) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=2)
    if len(parts) < 3:
        await message.answer("Открой ученика кнопкой и нажми «Выдать ДЗ».")
        return
    try:
        student_id = positive_int(parts[1], "ID ученика")
    except ValueError as error:
        await message.answer(str(error))
        return
    if db.get_student(student_id) is None:
        await message.answer("Ученик не найден.")
        return
    item = assign_homework(db, student_id, parts[2])
    await message.answer(f"ДЗ выдано: #{item.id}")
    await notify_student_users(bot, db, student_id, f"Новое домашнее задание:\n{homework_line(item)}")


@router.message(Command("debts"))
@router.message(F.text == "Должники")
async def debts(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    await send_debts_menu(message, db)


async def send_debts_menu(message: Message, db: SQLiteStorage) -> None:
    await message.answer("Автоматический список должников отключен: бот работает по постоплате.")


@router.callback_query(F.data == "admin_menu:debts")
async def debts_from_admin_menu(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    await callback.answer()
    await send_debts_menu(callback.message, db)


@router.message(Command("pending_payments"))
@router.message(F.text == "Ожидают оплаты")
async def pending_payments(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    await send_pending_payments_menu(message, db)


async def send_pending_payments_menu(message: Message, db: SQLiteStorage) -> None:
    payments = db.list_pending_payments()
    if not payments:
        await message.answer("Чеков на проверке нет.")
        return
    for payment in payments:
        student = db.get_student(payment.student_id)
        await message.answer(
            payment_line(payment, student),
            reply_markup=payment_actions_keyboard(payment),
        )


@router.callback_query(F.data == "admin_menu:payments")
async def pending_payments_from_admin_menu(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    await callback.answer()
    await send_pending_payments_menu(callback.message, db)


@router.callback_query(F.data == "back:payments")
async def back_to_pending_payments(callback: CallbackQuery, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    await callback.answer()
    await callback.message.edit_text("Открываю чеки на проверке...")
    await send_pending_payments_menu(callback.message, db)


@router.callback_query(F.data.startswith("pay_confirm:"))
async def confirm_payment_button(
    callback: CallbackQuery,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    payment = confirm_payment(db, int(callback.data.split(":", 1)[1]))
    student = db.get_student(payment.student_id)
    await callback.answer("Подтверждено")
    await callback.message.edit_text(f"Оплата подтверждена:\n{payment_line(payment, student)}")
    await notify_student_users(bot, db, payment.student_id, "Оплата подтверждена.")


@router.callback_query(F.data.startswith("pay_reject:"))
async def reject_payment_button(
    callback: CallbackQuery,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    payment = reject_payment(db, int(callback.data.split(":", 1)[1]), "Отклонено администратором")
    await callback.answer("Отклонено")
    await callback.message.edit_text(f"Оплата отклонена: #{payment.id}")
    await notify_student_users(bot, db, payment.student_id, "Оплату нужно проверить и отправить чек повторно.")


@router.callback_query(F.data.startswith("lesson_request_confirm:"))
async def confirm_lesson_request_button(
    callback: CallbackQuery,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    lesson = db.get_lesson(int(callback.data.split(":", 1)[1]))
    if lesson is None:
        await callback.answer("Занятие не найдено", show_alert=True)
        return
    student = db.get_student(lesson.student_id)
    lesson.status = LessonStatus.PLANNED.value
    db.update_lesson(lesson)
    await callback.answer("Подтверждено")
    await callback.message.edit_text(
        "\n".join(
            [
                "✅ Заявка подтверждена",
                "",
                lesson_line(lesson, student),
            ]
        )
    )
    await notify_student_users(
        bot,
        db,
        lesson.student_id,
        "\n".join(
            [
                "✅ Занятие подтверждено",
                "",
                lesson_public_line(lesson, student),
            ]
        ),
        reply_markup=lesson_calendar_keyboard(lesson.id),
    )


@router.callback_query(F.data.startswith("lesson_request_move:"))
async def suggest_lesson_request_move_button(
    callback: CallbackQuery,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    if callback.from_user.id not in settings.admin_telegram_ids:
        await callback.answer("Нет доступа", show_alert=True)
        return
    lesson = db.get_lesson(int(callback.data.split(":", 1)[1]))
    if lesson is None:
        await callback.answer("Занятие не найдено", show_alert=True)
        return
    student = db.get_student(lesson.student_id)
    await callback.answer("Отправил ученику")
    await callback.message.edit_text(
        "\n".join(
            [
                "↪️ Предложен перенос",
                "",
                lesson_line(lesson, student),
                "Ученик получил просьбу выбрать другое время.",
            ]
        )
    )
    await notify_student_users(
        bot,
        db,
        lesson.student_id,
        "\n".join(
            [
                "↪️ Преподаватель предложил перенести занятие",
                "",
                lesson_public_line(lesson, student),
                "Выбери новое время через Mini App или кнопку «Записаться» в боте.",
            ]
        ),
        reply_markup=student_menu(settings.telegram_webapp_url),
    )


@router.callback_query(F.data.startswith("student_lesson_confirm:"))
async def confirm_lesson_by_student_button(
    callback: CallbackQuery,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    lesson = db.get_lesson(int(callback.data.split(":", 1)[1]))
    if lesson is None:
        await callback.answer("Занятие не найдено", show_alert=True)
        return
    account = resolve_callback_account(callback, db, settings)
    if not account or account.student_id != lesson.student_id:
        await callback.answer("Нет доступа", show_alert=True)
        return
    if lesson.status != LessonStatus.PENDING_CONFIRMATION.value:
        await callback.answer("Это занятие уже обработано", show_alert=True)
        return
    student = db.get_student(lesson.student_id)
    lesson.status = LessonStatus.PLANNED.value
    db.update_lesson(lesson)
    await callback.answer("Подтверждено")
    await callback.message.edit_text(
        "\n".join(["✅ Занятие подтверждено", "", lesson_public_line(lesson, student)]),
        reply_markup=lesson_calendar_keyboard(lesson.id),
    )
    await notify_admins(
        bot,
        settings,
        "\n".join(
            [
                "✅ Ученик подтвердил занятие",
                "",
                lesson_line(lesson, student),
            ]
        ),
    )


@router.message(Command("confirm_payment"))
async def confirm_payment_command(
    message: Message,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=1)
    if len(parts) < 2:
        await message.answer("Открой «Ожидают оплаты» и нажми «Подтвердить».")
        return
    try:
        payment = confirm_payment(db, positive_int(parts[1], "ID оплаты"))
    except ValueError as error:
        await message.answer(str(error))
        return
    student = db.get_student(payment.student_id)
    await message.answer(f"Оплата подтверждена:\n{payment_line(payment, student)}")
    await notify_student_users(bot, db, payment.student_id, "Оплата подтверждена.")


@router.message(Command("prepay"))
async def prepay_lessons_command(
    message: Message,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=2)
    if len(parts) < 3:
        await message.answer("Пример: /prepay 3 4 — подтвердить оплату вперед на 4 занятия.")
        return
    try:
        student_id = positive_int(parts[1], "ID ученика")
        lessons_count = positive_int(parts[2], "Количество занятий")
    except ValueError as error:
        await message.answer(str(error))
        return
    student = db.get_student(student_id)
    if student is None:
        await message.answer("Ученик не найден.")
        return
    payment = db.add_payment(
        Payment(
            student_id=student.id,
            amount=0,
            lessons_count=lessons_count,
            sender_role=Role.ADMIN.value,
            sender_telegram_id=message.from_user.id,
            comment="Оплата вперед подтверждена администратором",
        )
    )
    confirmed = confirm_payment(db, payment.id)
    await message.answer(f"Оплата вперед подтверждена:\n{payment_line(confirmed, student)}")
    await notify_student_users(bot, db, student.id, "Оплата подтверждена.")


@router.message(Command("reject_payment"))
async def reject_payment_command(
    message: Message,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=2)
    if len(parts) < 2:
        await message.answer("Открой «Ожидают оплаты» и нажми «Отклонить».")
        return
    try:
        payment = reject_payment(db, positive_int(parts[1], "ID оплаты"), parts[2] if len(parts) >= 3 else "")
    except ValueError as error:
        await message.answer(str(error))
        return
    await message.answer(f"Оплата отклонена: #{payment.id}")
    await notify_student_users(bot, db, payment.student_id, "Оплату нужно проверить и отправить чек повторно.")


@router.message(Command("plan"))
async def add_plan_item(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=2)
    if len(parts) < 3:
        await message.answer("План пока оставил как служебный текстовый сценарий.")
        return
    try:
        student_id = positive_int(parts[1], "ID ученика")
    except ValueError as error:
        await message.answer(str(error))
        return
    if db.get_student(student_id) is None:
        await message.answer("Ученик не найден.")
        return
    position = len(db.list_plan_items(student_id)) + 1
    item = db.upsert_plan_item(PlanItem(student_id=student_id, title=parts[2], position=position))
    await message.answer(f"Пункт плана добавлен: #{item.id}")


@router.message(Command("prep_plan"))
async def save_prep_plan(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    raw = message.caption if message.photo else message.text
    parts = (raw or "").split(maxsplit=2)
    if len(parts) < 2:
        await message.answer(
            "План подготовки: /prep_plan ID ученика текст\n"
            "Или отправь картинку с подписью: /prep_plan ID ученика"
        )
        return
    try:
        student_id = positive_int(parts[1], "ID ученика")
    except ValueError as error:
        await message.answer(str(error))
        return
    student = db.get_student(student_id)
    if student is None:
        await message.answer("Ученик не найден.")
        return

    if message.photo:
        student.prep_plan_file_id = message.photo[-1].file_id
        if len(parts) >= 3:
            student.prep_plan_text = parts[2]
    else:
        if len(parts) < 3:
            await message.answer("Добавь текст плана после ID ученика.")
            return
        student.prep_plan_text = parts[2]
        student.prep_plan_file_id = ""
    db.update_student(student)
    await message.answer("План подготовки сохранен.")


@router.message(Command("task_progress"))
async def set_task_progress(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=3)
    if len(parts) < 4:
        await message.answer("Пример: /task_progress 1 13 7")
        return
    try:
        student_id = positive_int(parts[1], "ID ученика")
        task_number = positive_int(parts[2], "Номер задания")
        level = parse_knowledge_level(parts[3])
    except ValueError as error:
        await message.answer(str(error))
        return
    student = db.get_student(student_id)
    if student is None:
        await message.answer("Ученик не найден.")
        return
    ensure_exam_tasks(db, student)
    title = f"Задание {task_number}"
    topic = db.find_prep_topic_by_title(student_id, title)
    if topic is None:
        topic = PrepTopic(student_id=student_id, title=title)
    topic.knowledge_level = level
    topic.status = knowledge_status(level)
    db.upsert_prep_topic(topic)
    topics = db.list_prep_topics(student_id)
    student.progress_current = sum(1 for item in topics if item.knowledge_level >= 7)
    db.update_student(student)
    await message.answer(f"{title}: уровень {level}/10 сохранен.")


@router.message(Command("topic"))
async def add_topic(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    if not is_admin(message, settings):
        return
    parts = (message.text or "").split(maxsplit=2)
    if len(parts) < 3:
        await message.answer("Темы пока оставил как служебный текстовый сценарий.")
        return
    chunks = [chunk.strip() for chunk in parts[2].split("|")]
    title = chunks[0]
    status = chunks[1] if len(chunks) >= 2 and chunks[1] else PrepTopicStatus.STARTED.value
    solved = int_or_default(chunks[2] if len(chunks) >= 3 else "0", 0)
    level = int_or_default(chunks[3] if len(chunks) >= 4 else "0", 0)
    try:
        student_id = positive_int(parts[1], "ID ученика")
    except ValueError as error:
        await message.answer(str(error))
        return
    if db.get_student(student_id) is None:
        await message.answer("Ученик не найден.")
        return
    topic = db.upsert_prep_topic(
        PrepTopic(
            student_id=student_id,
            title=title,
            status=status,
            solved_count=solved,
            knowledge_level=max(0, min(level, 10)),
        )
    )
    await message.answer(f"Статистика темы сохранена: #{topic.id}")


@router.message(Command("me"))
@router.message(F.text == "Ближайшее занятие")
async def my_cabinet(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await message.answer("Пока не вижу привязанную карточку. Заполни анкету или напиши администратору.")
        return
    student = db.get_student(account.student_id)
    if student is None:
        await message.answer("Карточка не найдена. Открой Mini App или заполни анкету заново.", reply_markup=first_start_menu(settings.telegram_webapp_url))
        return
    lessons = db.list_student_lessons(student.id, limit=20)
    now = settings.local_now()
    future = sorted(
        [
            lesson
            for lesson in lessons
            if lesson.status == LessonStatus.PLANNED.value and lesson.starts_at >= now
        ],
        key=lambda lesson: lesson.starts_at,
    )
    next_lesson = future[0] if future else None
    lines = [f"{student.full_name}"]
    if next_lesson:
        lines.append(f"Ближайшее занятие: {lesson_public_line(next_lesson, student)}")
        if student.meeting_url:
            lines.append(f"Телемост: {student.meeting_url}")
        if student.board_url:
            lines.append(f"Доска: {student.board_url}")
    else:
        lines.append("Ближайших занятий нет.")
    if settings.teacher_chat_link:
        lines.append(f"Чат с преподавателем: {settings.teacher_chat_link}")
    await message.answer(
        "\n".join(lines),
        reply_markup=lesson_calendar_keyboard(next_lesson.id) if next_lesson else student_menu(settings.telegram_webapp_url),
    )


@router.message(F.text == "Моя карточка")
async def my_card(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await message.answer("Карточка не найдена. Открой Mini App или заполни анкету заново.", reply_markup=first_start_menu(settings.telegram_webapp_url))
        return
    student = db.get_student(account.student_id)
    if student is None:
        await message.answer("Карточка не найдена. Открой Mini App или заполни анкету заново.", reply_markup=first_start_menu(settings.telegram_webapp_url))
        return
    text = format_student_public_card(student)
    if settings.teacher_chat_link:
        text += f"\nЧат с преподавателем: {settings.teacher_chat_link}"
    await message.answer(
        text,
        reply_markup=student_self_actions_keyboard(student.id, allow_delete=account.role == Role.STUDENT.value),
    )


@router.message(Command("my_schedule"))
@router.message(F.text == "Мое расписание")
async def my_schedule(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await message.answer("Карточка не найдена.")
        return
    lessons = [
        lesson
        for lesson in db.list_student_lessons(account.student_id, limit=50)
        if lesson.status == LessonStatus.PLANNED.value and lesson.starts_at >= settings.local_now()
    ]
    if not lessons:
        await message.answer("Запланированных занятий нет.")
        return
    student = db.get_student(account.student_id)
    if student is None:
        await message.answer("Карточка не найдена.")
        return
    for lesson in sorted(lessons, key=lambda item: item.starts_at):
        await message.answer(
            lesson_public_line(lesson, student),
            reply_markup=student_lesson_actions_keyboard(lesson.id),
        )


@router.message(Command("slots"))
@router.message(Command("book"))
@router.message(F.text == "Записаться")
async def start_booking(message: Message, state: FSMContext, db: SQLiteStorage, settings: Settings) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await message.answer("Карточка не найдена.")
        return
    student = db.get_student(account.student_id)
    if student is None:
        await message.answer("Карточка не найдена.")
        return
    await state.set_state(Booking.choosing_duration)
    await state.update_data(student_id=student.id, actor_role=account.role, booking_source="student")
    await message.answer(
        "Выбери продолжительность занятия:",
        reply_markup=duration_keyboard(student, "back:student_menu"),
    )


@router.callback_query(F.data == "back:student_menu")
async def back_to_student_menu(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.answer()
    await callback.message.edit_text("Возвращаю в меню. Используй кнопки снизу.", reply_markup=None)


@router.callback_query(F.data == "bookback:card")
async def booking_back_to_admin_card(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
) -> None:
    data = await state.get_data()
    student = db.get_student(int(data["student_id"]))
    await state.clear()
    if student is None:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    await callback.answer()
    await callback.message.edit_text(
        await build_student_card_text(db, student, settings),
        reply_markup=student_admin_actions_keyboard(student.id),
    )


@router.callback_query(Booking.choosing_duration, F.data.startswith("bookdur:"))
async def choose_booking_duration(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
) -> None:
    duration = int(callback.data.split(":", 1)[1])
    data = await state.get_data()
    student = db.get_student(int(data["student_id"]))
    if student is None:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    price = format_lesson_price_for_duration(student, duration)
    await state.set_state(Booking.choosing_date)
    await state.update_data(duration=duration, booking_start_offset=0)
    await callback.answer()
    await callback.message.edit_text(
        f"Продолжительность: {duration} мин.\nСтоимость: {price}\nВыбери дату:",
        reply_markup=booking_dates_keyboard(
            today=settings.local_today(),
            back_callback="bookback:duration",
        ),
    )


@router.callback_query(Booking.choosing_date, F.data == "bookback:duration")
async def booking_back_to_duration(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
) -> None:
    data = await state.get_data()
    student = db.get_student(int(data["student_id"]))
    if student is None:
        await state.clear()
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    await state.set_state(Booking.choosing_duration)
    await callback.answer()
    await callback.message.edit_text(
        "Выбери продолжительность занятия:",
        reply_markup=duration_keyboard(student, booking_cancel_callback(data)),
    )


@router.callback_query(Booking.choosing_date, F.data.startswith("bookweek:"))
async def choose_booking_week(callback: CallbackQuery, state: FSMContext, settings: Settings) -> None:
    start_offset = int(callback.data.split(":", 1)[1])
    await state.update_data(booking_start_offset=start_offset)
    await callback.answer()
    label = "Следующая неделя" if start_offset else "Эта неделя"
    await callback.message.edit_text(
        f"{label}. Выбери дату:",
        reply_markup=booking_dates_keyboard(
            start_offset=start_offset,
            today=settings.local_today(),
            back_callback="bookback:duration",
        ),
    )


@router.callback_query(Booking.choosing_date, F.data.startswith("bookdate:"))
async def choose_booking_date(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
    work_hours: WorkHours,
) -> None:
    selected_day = date.fromisoformat(callback.data.split(":", 1)[1])
    data = await state.get_data()
    student = db.get_student(int(data["student_id"]))
    duration = int(data["duration"])
    start_offset = int(data.get("booking_start_offset", 0))
    if student is None:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    items = available_slots(db, selected_day, duration, work_hours)
    await callback.answer()
    if not items:
        await callback.message.edit_text(
            f"{ru_date(selected_day)} свободных слотов нет.\nВыбери другую дату:",
            reply_markup=booking_dates_keyboard(
                start_offset=start_offset,
                today=settings.local_today(),
                back_callback="bookback:duration",
            ),
        )
        return
    await state.set_state(Booking.choosing_time)
    await state.update_data(selected_day=selected_day.isoformat())
    timezone_note = (
        f"Время показано в твоем часовом поясе: {timezone_label(student.timezone)}."
        if student.timezone != settings.timezone
        else f"Время показано по {timezone_label(settings.timezone)}."
    )
    await callback.message.edit_text(
        f"{ru_date(selected_day)}\n{timezone_note}\nВыбери свободное время:",
        reply_markup=booking_times_keyboard(
            items,
            "bookback:date",
            display_timezone=student.timezone,
            source_timezone=settings.timezone,
        ),
    )


@router.callback_query(Booking.choosing_time, F.data == "bookback:date")
async def booking_back_to_date(callback: CallbackQuery, state: FSMContext, settings: Settings) -> None:
    data = await state.get_data()
    start_offset = int(data.get("booking_start_offset", 0))
    await state.set_state(Booking.choosing_date)
    await callback.answer()
    await callback.message.edit_text(
        "Выбери дату:",
        reply_markup=booking_dates_keyboard(
            start_offset=start_offset,
            today=settings.local_today(),
            back_callback="bookback:duration",
        ),
    )


@router.callback_query(Booking.choosing_time, F.data.startswith("booktime:"))
async def choose_booking_time(
    callback: CallbackQuery,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
    work_hours: WorkHours,
    bot: Bot,
) -> None:
    data = await state.get_data()
    student = db.get_student(int(data["student_id"]))
    duration = int(data["duration"])
    starts_at = datetime.fromisoformat(callback.data.split(":", 1)[1])
    if student is None:
        await callback.answer("Карточка не найдена", show_alert=True)
        return
    try:
        lesson = add_single_lesson(db, student.id, starts_at, duration, work_hours)
    except SlotUnavailableError:
        await callback.answer("Этот слот уже занят или закрыт", show_alert=True)
        return
    await state.clear()
    price = format_lesson_price_for_duration(student, duration)
    if data.get("actor_role") == Role.ADMIN.value and data.get("booking_source") == "admin_add":
        lesson.status = LessonStatus.PENDING_CONFIRMATION.value
        db.update_lesson(lesson)
        await callback.answer("Занятие добавлено")
        await callback.message.edit_text(
            f"Занятие добавлено и отправлено ученику на подтверждение:\n{lesson_line(lesson, student)}\nСтоимость: {price}",
            reply_markup=student_admin_actions_keyboard(student.id),
        )
        await notify_student_users(
            bot,
            db,
            student.id,
            student_lesson_confirmation_text(student, lesson),
            reply_markup=student_lesson_confirmation_keyboard(lesson.id),
        )
        return

    lesson.status = LessonStatus.PENDING_CONFIRMATION.value
    db.update_lesson(lesson)
    await callback.answer("Запись создана")
    lines = [
        "Заявка отправлена преподавателю.",
        "",
        lesson_public_line(lesson, student),
        f"Стоимость: {price}",
    ]
    if settings.teacher_chat_link:
        lines.append(f"Чат с преподавателем: {settings.teacher_chat_link}")
    await callback.message.edit_text(
        "\n".join(lines),
        reply_markup=lesson_calendar_keyboard(lesson.id),
    )
    await notify_admins(
        bot,
        settings,
        lesson_request_admin_text(student, lesson),
        reply_markup=lesson_request_actions_keyboard(lesson.id),
    )


@router.message(Command("slots_text"))
async def slots_text(message: Message, db: SQLiteStorage, settings: Settings, work_hours: WorkHours) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await message.answer("Карточка не найдена.")
        return
    parts = (message.text or "").split(maxsplit=1)
    if len(parts) < 2:
        await message.answer("Для записи нажми кнопку «Записаться».")
        return
    student = db.get_student(account.student_id)
    items = available_slots(
        db,
        parse_day(parts[1], today=settings.local_today()),
        student.lesson_duration_minutes,
        work_hours,
    )
    if not items:
        await message.answer("Свободных слотов на эту дату нет.")
        return
    await message.answer(
        "Свободные слоты:\n"
        + "\n".join(
            convert_timezone(item, settings.timezone, student.timezone).strftime("%H:%M")
            for item in items
        )
        + f"\nВремя: {timezone_label(student.timezone)}."
        + "\nДля записи нажми кнопку «Записаться»."
    )


@router.message(Command("book_text"))
async def book(message: Message, db: SQLiteStorage, settings: Settings, work_hours: WorkHours, bot: Bot) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await message.answer("Карточка не найдена.")
        return
    parts = (message.text or "").split(maxsplit=2)
    if len(parts) < 3:
        await message.answer("Для записи нажми кнопку «Записаться».")
        return
    student = db.get_student(account.student_id)
    try:
        lesson = add_single_lesson(
            db,
            student.id,
            parse_start(parts[1], parts[2], today=settings.local_today()),
            student.lesson_duration_minutes,
            work_hours,
        )
    except SlotUnavailableError:
        await message.answer("Этот слот уже занят или закрыт. Нажми «Записаться» и выбери свободное время.")
        return
    await message.answer(f"Запись создана:\n{lesson_public_line(lesson, student)}")
    await notify_admins(bot, settings, f"Ученик записался:\n{lesson_line(lesson, student)}")


@router.message(Command("cancel"))
async def cancel_from_cabinet(message: Message, db: SQLiteStorage, settings: Settings, bot: Bot) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await message.answer("Карточка не найдена.")
        return
    parts = (message.text or "").split(maxsplit=2)
    if len(parts) < 2:
        await message.answer("Отмена из кабинета пока доступна через список занятий.")
        return
    try:
        lesson_id = positive_int(parts[1], "ID занятия")
    except ValueError as error:
        await message.answer(str(error))
        return
    lesson = db.get_lesson(lesson_id)
    if lesson is None or lesson.student_id != account.student_id:
        await message.answer("Занятие не найдено.")
        return
    try:
        lesson = cancel_lesson(db, lesson.id, account.role, parts[2] if len(parts) >= 3 else "")
    except ValueError as error:
        await message.answer(str(error))
        return
    student = db.get_student(lesson.student_id)
    await message.answer(f"Занятие отменено:\n{lesson_public_line(lesson, student)}")
    await notify_admins(
        bot,
        settings,
        f"Занятие отменено со стороны {account.role}:\n{lesson_line(lesson, student)}\n{student_line(student)}",
    )


@router.message(Command("payment"))
async def payment_command(message: Message, db: SQLiteStorage, settings: Settings, bot: Bot) -> None:
    await register_payment_from_text(message, db, settings, bot, message.text or "")


@router.message(F.text == "Отправить чек")
async def payment_button(message: Message, state: FSMContext, db: SQLiteStorage, settings: Settings) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await message.answer("Карточка не найдена.")
        return
    await state.set_state(PaymentFlow.receipt)
    await state.update_data(student_id=account.student_id)
    await send_state_prompt(message, state, "Отправь чек.")


@router.message(PaymentFlow.receipt)
async def payment_receipt_save(
    message: Message,
    state: FSMContext,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await state.clear()
        await message.answer("Карточка не найдена.")
        return
    payment = db.add_payment(
        Payment(
            student_id=account.student_id,
            amount=0,
            lessons_count=0,
            sender_role=account.role,
            sender_telegram_id=message.from_user.id,
            receipt_file_id=file_id_from_message(message),
            comment=message.text or message.caption or "",
        )
    )
    await state.clear()
    await message.answer("Чек отправлен.")
    student = db.get_student(account.student_id)
    await notify_admins(
        bot,
        settings,
        f"{student.full_name} отправил чек:\n{payment_line(payment, student)}\n{student_line(student)}",
    )
    await copy_message_to_admins(bot, settings, message)
    await cleanup_state_messages(message, state)


async def register_payment_from_text(
    message: Message,
    db: SQLiteStorage,
    settings: Settings,
    bot: Bot,
    raw_text: str,
) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await message.answer("Карточка не найдена.")
        return
    parts = raw_text.split(maxsplit=2)
    if len(parts) < 2:
        await message.answer("Нажми «Отправить чек» и пройди оплату кнопочным сценарием.")
        return
    try:
        amount = positive_int(parts[1], "Сумма")
    except ValueError as error:
        await message.answer(str(error))
        return
    lessons_count = int_or_default(parts[2] if len(parts) >= 3 else "", 0)
    payment = db.add_payment(
        Payment(
            student_id=account.student_id,
            amount=amount,
            lessons_count=lessons_count,
            sender_role=account.role,
            sender_telegram_id=message.from_user.id,
            receipt_file_id=file_id_from_message(message),
        )
    )
    await message.answer("Чек отправлен администратору и ожидает подтверждения.")
    student = db.get_student(account.student_id)
    await notify_admins(
        bot,
        settings,
        f"{student.full_name} отправил чек:\n{payment_line(payment, student)}\n{student_line(student)}",
    )


@router.message(Command("homework_current"))
@router.message(F.text == "Домашнее задание")
async def current_homework(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await message.answer("Карточка не найдена.")
        return
    homework = db.get_current_homework(account.student_id)
    if homework:
        await message.answer(homework_line(homework), reply_markup=homework_submit_keyboard(homework.id))
    else:
        await message.answer("Текущего ДЗ нет.")


@router.callback_query(F.data.startswith("submit_hw:"))
async def submit_hw_prompt(callback: CallbackQuery, state: FSMContext, db: SQLiteStorage, settings: Settings) -> None:
    if callback.from_user.id in settings.admin_telegram_ids:
        await callback.answer("Это кнопка ученика", show_alert=True)
        return
    homework_id = int(callback.data.split(":", 1)[1])
    await state.set_state(HomeworkSubmit.solution)
    await state.update_data(homework_id=homework_id, telegram_id=callback.from_user.id)
    await callback.answer()
    await send_state_prompt(callback.message, state, "Отправь решение текстом, фото или файлом.")


@router.message(HomeworkSubmit.solution)
async def submit_hw_button_save(message: Message, state: FSMContext, db: SQLiteStorage, settings: Settings, bot: Bot) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await state.clear()
        await message.answer("Карточка не найдена.")
        return
    data = await state.get_data()
    content = message.text or message.caption or ""
    file_id = file_id_from_message(message)
    try:
        submit_homework(
            db,
            int(data["homework_id"]),
            account.student_id,
            content,
            [file_id] if file_id else [],
        )
    except ValueError:
        await state.clear()
        await message.answer("Это ДЗ не найдено или относится к другой карточке.")
        return
    await cleanup_state_messages(message, state)
    await state.clear()
    await message.answer("ДЗ отправлено на проверку.")
    student = db.get_student(account.student_id)
    await notify_admins(bot, settings, f"{student.full_name} сдал ДЗ #{data['homework_id']}.\n{student_line(student)}")


@router.message(Command("submit_hw"))
async def submit_hw(message: Message, db: SQLiteStorage, settings: Settings, bot: Bot) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await message.answer("Карточка не найдена.")
        return
    parts = (message.text or "").split(maxsplit=2)
    if len(parts) < 3:
        await message.answer("Открой «Домашнее задание» и нажми «Сдать ДЗ».")
        return
    try:
        submit_homework(db, positive_int(parts[1], "ID ДЗ"), account.student_id, parts[2])
    except ValueError:
        await message.answer("Это ДЗ не найдено или относится к другой карточке.")
        return
    await message.answer("ДЗ отправлено на проверку.")
    student = db.get_student(account.student_id)
    await notify_admins(bot, settings, f"{student.full_name} сдал ДЗ #{parts[1]}.\n{student_line(student)}")


@router.message(Command("progress"))
@router.message(F.text == "Статистика")
async def progress(message: Message, db: SQLiteStorage, settings: Settings) -> None:
    account = resolve_account(message, db, settings)
    if not account or not account.student_id:
        await message.answer("Карточка не найдена.")
        return
    student = db.get_student(account.student_id)
    if student is None:
        await message.answer("Карточка не найдена.")
        return
    if student.progress_goal <= 0:
        await message.answer("Для успеваемости прогресс не ведется.")
        return
    ensure_exam_tasks(db, student)
    topics = db.list_prep_topics(student.id)
    lines = [
        f"Общий прогресс: {format_progress(student)}",
        "",
        "Уровни по заданиям:",
        format_knowledge_progress(topics),
    ]
    text = "\n".join(lines)
    if student.prep_plan_text:
        text += f"\n\nПлан подготовки:\n{student.prep_plan_text}"
    await message.answer(text)
    if student.prep_plan_file_id:
        await message.answer_photo(student.prep_plan_file_id, caption="План подготовки")
