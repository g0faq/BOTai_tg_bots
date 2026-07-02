from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import date, datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo


def _getenv(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _parse_int_list(raw: str) -> list[int]:
    return [int(item.strip()) for item in raw.split(",") if item.strip()]


def _parse_time(raw: str) -> time:
    hours, minutes = raw.split(":", 1)
    return time(hour=int(hours), minute=int(minutes))


def load_dotenv(path: str | Path = ".env") -> None:
    env_path = Path(path)
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(slots=True)
class Settings:
    bot_token: str
    admin_telegram_ids: list[int]
    teacher_chat_url: str
    database_path: str
    timezone: str
    default_lesson_price: int
    default_lesson_duration_minutes: int
    default_payment_package_size: int
    low_balance_threshold: int
    reminder_minutes_before_lesson: int
    working_days: list[int]
    working_start: time
    working_end: time
    slot_step_minutes: int
    google_sheets_spreadsheet_id: str = ""
    google_sheets_credentials_file: str = ""
    google_sheets_credentials_json: str = ""
    webapp_url: str = ""
    payment_details_text: str = ""

    @property
    def tzinfo(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @property
    def teacher_chat_link(self) -> str:
        if self.teacher_chat_url:
            return self.teacher_chat_url
        if self.admin_telegram_ids:
            return f"tg://user?id={self.admin_telegram_ids[0]}"
        return ""

    def local_now(self) -> datetime:
        return datetime.now(self.tzinfo).replace(tzinfo=None)

    def local_today(self) -> date:
        return self.local_now().date()

    @property
    def google_sheets_enabled(self) -> bool:
        return bool(
            self.google_sheets_spreadsheet_id
            and (self.google_sheets_credentials_file or self.google_sheets_credentials_json)
        )

    def google_sheets_credentials_info(self) -> dict[str, object] | None:
        if self.google_sheets_credentials_json:
            return json.loads(self.google_sheets_credentials_json)
        return None


def load_settings() -> Settings:
    return Settings(
        bot_token=_getenv("BOT_TOKEN"),
        admin_telegram_ids=_parse_int_list(_getenv("ADMIN_TELEGRAM_IDS")),
        teacher_chat_url=_getenv("TEACHER_CHAT_URL"),
        database_path=_getenv("DATABASE_PATH", "bot.sqlite3"),
        timezone=_getenv("TIMEZONE", "Europe/Moscow"),
        default_lesson_price=int(_getenv("DEFAULT_LESSON_PRICE", "1800")),
        default_lesson_duration_minutes=int(_getenv("DEFAULT_LESSON_DURATION_MINUTES", "90")),
        default_payment_package_size=int(_getenv("DEFAULT_PAYMENT_PACKAGE_SIZE", "4")),
        low_balance_threshold=int(_getenv("LOW_BALANCE_THRESHOLD", "1")),
        reminder_minutes_before_lesson=int(_getenv("REMINDER_MINUTES_BEFORE_LESSON", "5")),
        working_days=_parse_int_list(_getenv("WORKING_DAYS", "1,2,3,4,5,6,7")),
        working_start=_parse_time(_getenv("WORKING_START", "7:00")),
        working_end=_parse_time(_getenv("WORKING_END", "22:00")),
        slot_step_minutes=int(_getenv("SLOT_STEP_MINUTES", "30")),
        google_sheets_spreadsheet_id=_getenv("GOOGLE_SHEETS_SPREADSHEET_ID"),
        google_sheets_credentials_file=_getenv("GOOGLE_SHEETS_CREDENTIALS_FILE"),
        google_sheets_credentials_json=_getenv("GOOGLE_SHEETS_CREDENTIALS_JSON"),
        webapp_url=_getenv("WEBAPP_URL", "http://127.0.0.1:8000"),
        payment_details_text=_getenv("PAYMENT_DETAILS_TEXT"),
    )
