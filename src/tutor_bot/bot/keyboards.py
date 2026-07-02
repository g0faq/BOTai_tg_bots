from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, time, timedelta

from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    WebAppInfo,
)

from tutor_bot.bot.formatters import day_label, format_lesson_price_for_duration
from tutor_bot.domain.models import Lesson, Payment, StudentProfile
from tutor_bot.services.timezones import DEFAULT_TIMEZONE, convert_timezone

SUBJECTS = [
    "Информатика",
    "Математика",
    "Русский язык",
    "Физика",
    "Химия",
    "Биология",
    "Английский язык",
    "Обществознание",
    "История",
    "Литература",
]
PREP_TYPES = ["ЕГЭ", "ОГЭ", "Школьная программа", "ВПР", "ДВИ", "Олимпиады", "Python"]


def admin_menu(webapp_url: str = "") -> ReplyKeyboardMarkup:
    rows = [
        [KeyboardButton(text="Mini App", web_app=WebAppInfo(url=webapp_url))] if webapp_url else [],
        [KeyboardButton(text="Браузерная версия")],
        [KeyboardButton(text="Ученики"), KeyboardButton(text="Расписание")],
        [KeyboardButton(text="Заявки"), KeyboardButton(text="Финансы")],
        [KeyboardButton(text="Добавить ученика")],
        [KeyboardButton(text="Ожидают оплаты")],
        [KeyboardButton(text="Помощь админа")],
    ]
    return ReplyKeyboardMarkup(keyboard=[row for row in rows if row], resize_keyboard=True)


def admin_help_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Ученики", callback_data="admin_menu:students"),
                InlineKeyboardButton(text="Расписание", callback_data="admin_menu:schedule"),
            ],
            [
                InlineKeyboardButton(text="Ожидают оплаты", callback_data="admin_menu:payments"),
                InlineKeyboardButton(text="Заявки", callback_data="admin_menu:lesson_requests"),
            ],
            [
                InlineKeyboardButton(text="Что внутри ученика", callback_data="admin_menu:student_tools"),
                InlineKeyboardButton(text="Что внутри урока", callback_data="admin_menu:lesson_tools"),
            ],
        ]
    )


def back_button(callback_data: str) -> InlineKeyboardButton:
    return InlineKeyboardButton(text="Назад", callback_data=callback_data)


def student_menu(webapp_url: str = "") -> ReplyKeyboardMarkup:
    rows = [
        [KeyboardButton(text="Открыть Mini App", web_app=WebAppInfo(url=webapp_url))] if webapp_url else [],
        [KeyboardButton(text="Браузерная версия")],
        [KeyboardButton(text="Помощь")],
    ]
    return ReplyKeyboardMarkup(keyboard=[row for row in rows if row], resize_keyboard=True)


def first_start_menu(webapp_url: str = "") -> ReplyKeyboardMarkup:
    rows = [
        [KeyboardButton(text="Открыть Mini App", web_app=WebAppInfo(url=webapp_url))] if webapp_url else [],
        [KeyboardButton(text="Браузерная версия")],
        [KeyboardButton(text="Заполнить анкету в чате")],
    ]
    return ReplyKeyboardMarkup(
        keyboard=[row for row in rows if row],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


def role_choice_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Я ученик", callback_data="qrole:student"),
                InlineKeyboardButton(text="Я родитель", callback_data="qrole:parent"),
            ]
        ]
    )


def subject_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=subject, callback_data=f"qsubject:{subject}")]
            for subject in SUBJECTS
        ] + [[InlineKeyboardButton(text="Другое", callback_data="qsubject:__other__")]]
    )


def prep_type_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=prep_type, callback_data=f"qprep:{prep_type}")]
            for prep_type in PREP_TYPES
        ] + [[InlineKeyboardButton(text="Другое", callback_data="qprep:__other__")]]
    )


def parent_rights_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Только просмотр и оплата", callback_data="qparent_rights:view")],
            [InlineKeyboardButton(text="Можно редактировать календарь", callback_data="qparent_rights:edit")],
        ]
    )


def students_keyboard(students: Iterable[StudentProfile]) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text=student.full_name, callback_data=f"student:{student.id}")]
        for student in students
    ]
    rows.append([back_button("back:admin_menu")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def student_admin_actions_keyboard(student_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Редактировать", callback_data=f"student_edit:{student_id}")],
            [
                InlineKeyboardButton(text="Цена", callback_data=f"student_price:{student_id}"),
                InlineKeyboardButton(text="Ссылки", callback_data=f"student_links:{student_id}"),
            ],
            [
                InlineKeyboardButton(text="Выдать ДЗ", callback_data=f"student_hw:{student_id}"),
                InlineKeyboardButton(text="Удалить", callback_data=f"student_delete:{student_id}"),
            ],
            [
                InlineKeyboardButton(text="Добавить разовое", callback_data=f"student_add_lesson:{student_id}"),
                InlineKeyboardButton(
                    text="Добавить стабильное",
                    callback_data=f"student_regular:{student_id}",
                ),
            ],
            [
                InlineKeyboardButton(
                    text="Очистить стабильное",
                    callback_data=f"student_clear_regular:{student_id}",
                ),
            ],
            [back_button("back:students")],
        ]
    )


def student_self_actions_keyboard(student_id: int, allow_delete: bool = True) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text="Редактировать", callback_data=f"self_edit:{student_id}")],
        [InlineKeyboardButton(text="Очистить стабильное", callback_data=f"self_clear_regular:{student_id}")],
    ]
    if allow_delete:
        rows.append([InlineKeyboardButton(text="Удалить аккаунт", callback_data=f"self_delete:{student_id}")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def confirm_delete_student_keyboard(student_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Да, удалить", callback_data=f"student_delete_yes:{student_id}"),
                InlineKeyboardButton(text="Оставить", callback_data=f"student:{student_id}"),
            ]
        ]
    )


def confirm_self_delete_keyboard(student_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Да, удалить аккаунт", callback_data=f"self_delete_yes:{student_id}"),
                InlineKeyboardButton(text="Оставить", callback_data=f"self_card:{student_id}"),
            ]
        ]
    )


def edit_card_keyboard(student_id: int, scope: str) -> InlineKeyboardMarkup:
    rows = [
        [
            InlineKeyboardButton(text="ФИО", callback_data=f"edit_field:{scope}:{student_id}:full_name"),
            InlineKeyboardButton(text="Класс", callback_data=f"edit_field:{scope}:{student_id}:grade"),
        ],
        [
            InlineKeyboardButton(text="Предмет", callback_data=f"edit_pick:{scope}:{student_id}:subject"),
            InlineKeyboardButton(text="Подготовка", callback_data=f"edit_pick:{scope}:{student_id}:prep_type"),
        ],
        [
            InlineKeyboardButton(text="Цель", callback_data=f"edit_field:{scope}:{student_id}:goal"),
            InlineKeyboardButton(
                text="Уровень знаний",
                callback_data=f"edit_field:{scope}:{student_id}:current_level",
            ),
        ],
        [
            InlineKeyboardButton(text="Дата экзамена", callback_data=f"edit_field:{scope}:{student_id}:exam_date"),
            InlineKeyboardButton(text="Часовой пояс", callback_data=f"edit_field:{scope}:{student_id}:timezone"),
        ],
    ]
    if scope == "admin":
        rows.extend(
            [
                [
                    InlineKeyboardButton(
                        text="Цены",
                        callback_data=f"edit_field:{scope}:{student_id}:lesson_price",
                    ),
                    InlineKeyboardButton(
                        text="Ник ученика",
                        callback_data=f"edit_field:{scope}:{student_id}:student_telegram",
                    ),
                ],
                [
                    InlineKeyboardButton(
                        text="Ник родителя",
                        callback_data=f"edit_field:{scope}:{student_id}:parent_telegram",
                    ),
                    InlineKeyboardButton(
                        text="Имя родителя",
                        callback_data=f"edit_field:{scope}:{student_id}:parent_name",
                    ),
                ],
                [
                    InlineKeyboardButton(text="Доска", callback_data=f"edit_field:{scope}:{student_id}:board_url"),
                    InlineKeyboardButton(text="Телемост", callback_data=f"edit_field:{scope}:{student_id}:meeting_url"),
                ],
                [
                    InlineKeyboardButton(
                        text="Прогресс",
                        callback_data=f"edit_field:{scope}:{student_id}:progress",
                    ),
                    InlineKeyboardButton(text="Заметки", callback_data=f"edit_field:{scope}:{student_id}:comment"),
                ],
            ]
        )
    back_prefix = "student" if scope == "admin" else "self_card"
    rows.append([InlineKeyboardButton(text="Назад", callback_data=f"{back_prefix}:{student_id}")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def edit_choice_keyboard(student_id: int, scope: str, field: str) -> InlineKeyboardMarkup:
    if field == "subject":
        choices = [
            ("Информатика", "informatics"),
            ("Математика", "math"),
            ("Русский язык", "russian"),
            ("Физика", "physics"),
            ("Химия", "chemistry"),
            ("Биология", "biology"),
            ("Английский язык", "english"),
            ("Обществознание", "social"),
            ("История", "history"),
            ("Литература", "literature"),
        ]
    else:
        choices = [
            ("ЕГЭ", "ege"),
            ("ОГЭ", "oge"),
            ("Школьная программа", "school"),
            ("ВПР", "vpr"),
            ("ДВИ", "dvi"),
            ("Олимпиады", "olymp"),
            ("Python", "python"),
        ]
    rows = [
        [
            InlineKeyboardButton(
                text=label,
                callback_data=f"edit_choice:{scope}:{student_id}:{field}:{code}",
            )
        ]
        for label, code in choices
    ]
    back_callback = f"student_edit:{student_id}" if scope == "admin" else f"self_edit:{student_id}"
    rows.append([back_button(back_callback)])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def duration_keyboard(student: StudentProfile, back_callback: str | None = None) -> InlineKeyboardMarkup:
    rows = []
    for duration in (60, 90, 120):
        price = format_lesson_price_for_duration(student, duration)
        rows.append(
            [
                InlineKeyboardButton(
                    text=f"{duration} мин - {price}",
                    callback_data=f"bookdur:{duration}",
                )
            ]
        )
    if back_callback:
        rows.append([back_button(back_callback)])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def booking_dates_keyboard(
    start_offset: int = 0,
    days: int = 7,
    today: date | None = None,
    back_callback: str | None = None,
) -> InlineKeyboardMarkup:
    today = today or date.today()
    rows: list[list[InlineKeyboardButton]] = []
    current_row: list[InlineKeyboardButton] = []
    for offset in range(start_offset, start_offset + days):
        day = today + timedelta(days=offset)
        current_row.append(
            InlineKeyboardButton(
                text=day_label(day),
                callback_data=f"bookdate:{day.isoformat()}",
            )
        )
        if len(current_row) == 2:
            rows.append(current_row)
            current_row = []
    if current_row:
        rows.append(current_row)
    nav_row: list[InlineKeyboardButton] = []
    if start_offset > 0:
        nav_row.append(InlineKeyboardButton(text="Эта неделя", callback_data="bookweek:0"))
    if start_offset < 7:
        nav_row.append(
            InlineKeyboardButton(text="Следующая неделя", callback_data="bookweek:7")
        )
    if nav_row:
        rows.append(nav_row)
    if back_callback:
        rows.append([back_button(back_callback)])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def booking_times_keyboard(
    starts_at_values: Iterable[datetime],
    back_callback: str | None = None,
    display_timezone: str | None = None,
    source_timezone: str = DEFAULT_TIMEZONE,
) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    current_row: list[InlineKeyboardButton] = []
    for starts_at in starts_at_values:
        shown = convert_timezone(starts_at, source_timezone, display_timezone) if display_timezone else starts_at
        current_row.append(
            InlineKeyboardButton(
                text=shown.strftime("%H:%M"),
                callback_data=f"booktime:{starts_at.isoformat()}",
            )
        )
        if len(current_row) == 3:
            rows.append(current_row)
            current_row = []
    if current_row:
        rows.append(current_row)
    if back_callback:
        rows.append([back_button(back_callback)])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def recurring_weekdays_keyboard(back_callback: str | None = None) -> InlineKeyboardMarkup:
    days = [
        ("Пн", 1),
        ("Вт", 2),
        ("Ср", 3),
        ("Чт", 4),
        ("Пт", 5),
        ("Сб", 6),
        ("Вс", 7),
    ]
    rows: list[list[InlineKeyboardButton]] = []
    current_row: list[InlineKeyboardButton] = []
    for label, weekday in days:
        current_row.append(
            InlineKeyboardButton(text=label, callback_data=f"stableday:{weekday}")
        )
        if len(current_row) == 4:
            rows.append(current_row)
            current_row = []
    if current_row:
        rows.append(current_row)
    if back_callback:
        rows.append([back_button(back_callback)])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def recurring_times_keyboard(
    values: Iterable[time],
    back_callback: str | None = None,
) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    current_row: list[InlineKeyboardButton] = []
    for value in values:
        current_row.append(
            InlineKeyboardButton(
                text=value.strftime("%H:%M"),
                callback_data=f"stabletime:{value.strftime('%H:%M')}",
            )
        )
        if len(current_row) == 3:
            rows.append(current_row)
            current_row = []
    if current_row:
        rows.append(current_row)
    if back_callback:
        rows.append([back_button(back_callback)])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def admin_schedule_day_keyboard(lessons: Iterable[tuple[Lesson, StudentProfile]]) -> InlineKeyboardMarkup:
    rows = [
        [
            InlineKeyboardButton(
                text=f"{lesson.starts_at.strftime('%H:%M')} | {student.full_name}",
                callback_data=f"lesson:{lesson.id}",
            )
        ]
        for lesson, student in lessons
    ]
    rows.append([back_button("back:schedule")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def schedule_week_keyboard(start_offset: int) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    nav_row: list[InlineKeyboardButton] = []
    if start_offset > 0:
        nav_row.append(InlineKeyboardButton(text="Эта неделя", callback_data="schedule_week:0"))
    if start_offset < 7:
        nav_row.append(
            InlineKeyboardButton(text="Следующая неделя", callback_data="schedule_week:7")
        )
    if nav_row:
        rows.append(nav_row)
    rows.append([back_button("back:admin_menu")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def admin_lesson_actions_keyboard(lesson_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Добавить в календарь", callback_data=f"calendar:{lesson_id}")],
            [
                InlineKeyboardButton(text="Перенести", callback_data=f"move_lesson:{lesson_id}"),
                InlineKeyboardButton(text="Отменить", callback_data=f"admin_cancel:{lesson_id}"),
            ],
            [InlineKeyboardButton(text="Удалить", callback_data=f"admin_delete_lesson:{lesson_id}")],
            [back_button("back:schedule")],
        ]
    )


def lesson_request_actions_keyboard(lesson_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Подтвердить", callback_data=f"lesson_request_confirm:{lesson_id}"),
                InlineKeyboardButton(text="Предложить перенос", callback_data=f"lesson_request_move:{lesson_id}"),
            ],
            [InlineKeyboardButton(text="Открыть занятие", callback_data=f"lesson:{lesson_id}")],
        ]
    )


def lesson_calendar_keyboard(lesson_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Добавить в календарь", callback_data=f"calendar:{lesson_id}")],
            [InlineKeyboardButton(text="Перенести", callback_data=f"move_lesson:{lesson_id}")],
            [back_button("back:student_menu")],
        ]
    )


def student_lesson_confirmation_keyboard(lesson_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Подтвердить занятие", callback_data=f"student_lesson_confirm:{lesson_id}")],
            [InlineKeyboardButton(text="Перенести", callback_data=f"move_lesson:{lesson_id}")],
            [back_button("back:student_menu")],
        ]
    )


def student_lesson_actions_keyboard(lesson_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Добавить в календарь", callback_data=f"calendar:{lesson_id}")],
            [InlineKeyboardButton(text="Перенести", callback_data=f"move_lesson:{lesson_id}")],
            [back_button("back:student_menu")],
        ]
    )


def payment_actions_keyboard(payment: Payment) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Подтвердить", callback_data=f"pay_confirm:{payment.id}"),
                InlineKeyboardButton(text="Отклонить", callback_data=f"pay_reject:{payment.id}"),
            ],
            [back_button("back:payments")],
        ]
    )


def homework_submit_keyboard(homework_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Сдать ДЗ", callback_data=f"submit_hw:{homework_id}")]
        ]
    )
