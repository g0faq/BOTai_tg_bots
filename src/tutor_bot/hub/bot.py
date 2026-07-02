from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import Command
from aiogram.types import (
    BotCommand,
    KeyboardButton,
    MenuButtonWebApp,
    Message,
    ReplyKeyboardMarkup,
    WebAppInfo,
)

from tutor_bot.config import load_dotenv, load_settings
from tutor_bot.hub.storage import HubStorage

router = Router()


def app_keyboard(webapp_url: str) -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text="Открыть g0faq Hub", web_app=WebAppInfo(url=webapp_url))]],
        resize_keyboard=True,
    )


def is_master(message: Message, admin_ids: set[int]) -> bool:
    return bool(message.from_user and message.from_user.id in admin_ids)


@router.message(Command("start", "app"))
async def start(message: Message) -> None:
    settings = load_settings()
    if not is_master(message, set(settings.master_admin_ids or settings.admin_telegram_ids)):
        await message.answer("Нет доступа к g0faq Hub.")
        return
    await message.answer(
        "g0faq Hub готов. Открой Mini App для управления CRM-ботами.",
        reply_markup=app_keyboard(settings.telegram_hub_webapp_url),
    )


@router.message(Command("bots"))
async def bots(message: Message) -> None:
    settings = load_settings()
    if not is_master(message, set(settings.master_admin_ids or settings.admin_telegram_ids)):
        await message.answer("Нет доступа.")
        return
    db = HubStorage(settings.hub_database_path)
    try:
        items = db.list_managed_bots()
        if not items:
            await message.answer("Подключенных ботов пока нет.", reply_markup=app_keyboard(settings.telegram_hub_webapp_url))
            return
        text = "\n".join(f"@{bot['bot_username']} · {bot['tutor_name']} · {bot['status']}" for bot in items[:20])
        await message.answer(text, reply_markup=app_keyboard(settings.telegram_hub_webapp_url))
    finally:
        db.close()


@router.message(Command("stats"))
async def stats(message: Message) -> None:
    settings = load_settings()
    if not is_master(message, set(settings.master_admin_ids or settings.admin_telegram_ids)):
        await message.answer("Нет доступа.")
        return
    db = HubStorage(settings.hub_database_path)
    try:
        overview = db.overview()
        await message.answer(
            "\n".join(
                [
                    "g0faq Hub статистика",
                    f"Ботов: {overview['total_bots']}",
                    f"Активных: {overview['active_bots']}",
                    f"Выручка по тарифам: {overview['expected_revenue']} ₽",
                    f"Уроков сегодня: {overview['lessons_today']}",
                    f"Учеников всего: {overview['students_count']}",
                ]
            ),
            reply_markup=app_keyboard(settings.telegram_hub_webapp_url),
        )
    finally:
        db.close()


@router.message(Command("help"))
async def help_command(message: Message) -> None:
    await message.answer("/app - открыть Hub\n/bots - список ботов\n/stats - общая статистика\n/help - помощь")


async def setup_hub_menu(bot: Bot, webapp_url: str) -> None:
    if not webapp_url:
        return
    try:
        await bot.set_my_commands(
            [
                BotCommand(command="start", description="Запустить g0faq Hub"),
                BotCommand(command="app", description="Открыть g0faq Hub"),
                BotCommand(command="bots", description="Список CRM-ботов"),
                BotCommand(command="stats", description="Общая статистика"),
                BotCommand(command="help", description="Помощь"),
            ]
        )
        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(text="g0faq Hub", web_app=WebAppInfo(url=webapp_url))
        )
    except Exception:
        logging.exception("Failed to set g0faq Hub menu button")


async def main() -> None:
    load_dotenv()
    settings = load_settings()
    if not settings.hub_bot_token:
        raise RuntimeError("HUB_BOT_TOKEN is required")
    logging.basicConfig(level=logging.INFO)
    bot = Bot(settings.hub_bot_token)
    await setup_hub_menu(bot, settings.telegram_hub_webapp_url)
    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    await dispatcher.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
