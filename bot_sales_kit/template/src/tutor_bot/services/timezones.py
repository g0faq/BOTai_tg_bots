from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "Europe/Moscow"

TIMEZONE_ALIASES = {
    "мск": "Europe/Moscow",
    "москва": "Europe/Moscow",
    "moscow": "Europe/Moscow",
    "msk": "Europe/Moscow",
    "екб": "Asia/Yekaterinburg",
    "екатеринбург": "Asia/Yekaterinburg",
    "novosibirsk": "Asia/Novosibirsk",
    "нск": "Asia/Novosibirsk",
    "новосибирск": "Asia/Novosibirsk",
    "красноярск": "Asia/Krasnoyarsk",
    "иркутск": "Asia/Irkutsk",
    "якутск": "Asia/Yakutsk",
    "владивосток": "Asia/Vladivostok",
    "алматы": "Asia/Almaty",
    "астана": "Asia/Almaty",
    "ташкент": "Asia/Tashkent",
}

MSK_OFFSET_PATTERN = re.compile(r"^(?:мск|msk)\s*([+-])\s*(\d{1,2})$", re.IGNORECASE)


def timezone_from_msk_offset(raw: str) -> str | None:
    value = raw.strip().replace(" ", "")
    if value.lower() in {"мск", "msk", "мск+0", "msk+0", "мск-0", "msk-0"}:
        return DEFAULT_TIMEZONE
    match = MSK_OFFSET_PATTERN.match(value)
    if not match:
        return None
    sign, amount_raw = match.groups()
    amount = int(amount_raw)
    if amount > 10:
        raise ValueError("Слишком большой сдвиг. Укажи формат вроде МСК+0, МСК+2 или МСК-1.")
    relative_offset = amount if sign == "+" else -amount
    utc_offset = 3 + relative_offset
    if utc_offset < -12 or utc_offset > 14:
        raise ValueError("Такой часовой пояс вне допустимого диапазона. Укажи формат вроде МСК+0 или МСК+3.")
    if utc_offset == 3:
        return DEFAULT_TIMEZONE
    # IANA Etc/GMT signs are inverted: Etc/GMT-6 means UTC+6.
    etc_sign = "-" if utc_offset >= 0 else "+"
    return f"Etc/GMT{etc_sign}{abs(utc_offset)}"


def normalize_timezone(raw: str | None, default: str = DEFAULT_TIMEZONE) -> str:
    value = (raw or "").strip()
    if not value or value == "-":
        return default
    msk_offset = timezone_from_msk_offset(value)
    if msk_offset:
        return msk_offset
    alias = TIMEZONE_ALIASES.get(value.lower())
    candidate = alias or value
    try:
        ZoneInfo(candidate)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(
            "Не знаю такой часовой пояс. Напиши в формате МСК+0, МСК+2, МСК-1 или IANA вроде Asia/Yekaterinburg."
        ) from exc
    return candidate


def timezone_label(timezone: str) -> str:
    if timezone == DEFAULT_TIMEZONE:
        return "МСК+0"
    etc_match = re.match(r"^Etc/GMT([+-])(\d{1,2})$", timezone)
    if etc_match:
        sign, amount_raw = etc_match.groups()
        utc_offset = int(amount_raw) * (1 if sign == "-" else -1)
        relative = utc_offset - 3
        if relative == 0:
            return "МСК+0"
        return f"МСК{relative:+d}"
    labels = {
        "Asia/Yekaterinburg": "Екб",
        "Asia/Novosibirsk": "Нск",
        "Asia/Krasnoyarsk": "Красноярск",
        "Asia/Irkutsk": "Иркутск",
        "Asia/Yakutsk": "Якутск",
        "Asia/Vladivostok": "Владивосток",
        "Asia/Almaty": "Алматы",
        "Asia/Tashkent": "Ташкент",
    }
    return labels.get(timezone, timezone)


def attach_timezone(value: datetime, timezone: str) -> datetime:
    if value.tzinfo is not None:
        return value
    return value.replace(tzinfo=ZoneInfo(timezone))


def convert_timezone(value: datetime, source_timezone: str, target_timezone: str) -> datetime:
    return attach_timezone(value, source_timezone).astimezone(ZoneInfo(target_timezone))
