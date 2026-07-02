from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    app_host: str = "0.0.0.0"
    app_port: int = 8001
    public_base_url: str = "https://crmtutor.ru"
    database_path: str = "data/crmtutor.sqlite3"
    legacy_database_path: str = "data/imported_legacy.sqlite3"
    jwt_secret: str = "change-me-in-production"
    access_token_ttl_minutes: int = 60
    refresh_token_ttl_days: int = 30
    default_workspace_slug: str = "fedor"
    default_tutor_first_name: str = "Федор"
    default_tutor_last_name: str = ""
    default_tutor_email: str = "owner@crmtutor.ru"
    telegram_bot_username: str = ""
    smtp_from_email: str = "noreply@crmtutor.ru"


def load_settings() -> Settings:
    return Settings(
        app_host=os.getenv("APP_HOST", "0.0.0.0"),
        app_port=int(os.getenv("APP_PORT", "8001")),
        public_base_url=os.getenv("PUBLIC_BASE_URL", "https://crmtutor.ru").rstrip("/"),
        database_path=os.getenv("DATABASE_PATH", "data/crmtutor.sqlite3"),
        legacy_database_path=os.getenv("LEGACY_DATABASE_PATH", "data/imported_legacy.sqlite3"),
        jwt_secret=os.getenv("JWT_SECRET", "change-me-in-production"),
        access_token_ttl_minutes=int(os.getenv("ACCESS_TOKEN_TTL_MINUTES", "60")),
        refresh_token_ttl_days=int(os.getenv("REFRESH_TOKEN_TTL_DAYS", "30")),
        default_workspace_slug=os.getenv("DEFAULT_WORKSPACE_SLUG", "fedor"),
        default_tutor_first_name=os.getenv("DEFAULT_TUTOR_FIRST_NAME", "Федор"),
        default_tutor_last_name=os.getenv("DEFAULT_TUTOR_LAST_NAME", ""),
        default_tutor_email=os.getenv("DEFAULT_TUTOR_EMAIL", "owner@crmtutor.ru"),
        telegram_bot_username=os.getenv("TELEGRAM_BOT_USERNAME", ""),
        smtp_from_email=os.getenv("SMTP_FROM_EMAIL", "noreply@crmtutor.ru"),
    )


def resolve_path(path: str) -> Path:
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    return Path.cwd() / candidate
