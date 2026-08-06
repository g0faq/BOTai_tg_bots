"""Heartbeat фонового цикла напоминаний.

Пишем в обычный файл рядом с базой, а не в SQLite: в контейнере в одну базу уже
пишут два процесса, и добавлять третий источник конкурентной записи ради
диагностики нельзя. Имя выводится из пути к базе, поэтому инстансы
(g0_faq_bot и sam_zabot) не перетирают heartbeat друг друга.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

HEARTBEAT_SUFFIX = ".reminder-heartbeat.json"
# Цикл тикает раз в 60 секунд; 5 минут тишины — это уже не задержка, а остановка.
STALE_AFTER_SECONDS = 300

logger = logging.getLogger(__name__)


def heartbeat_path(database_path: str | Path) -> Path:
    path = Path(database_path)
    return path.with_name(f"{path.stem}{HEARTBEAT_SUFFIX}")


def write_heartbeat(database_path: str | Path, last_error: str | None = None) -> None:
    """Атомарно записать отметку времени. Никогда не бросает исключений."""
    target = heartbeat_path(database_path)
    payload = {"ts": datetime.now(UTC).isoformat(), "last_error": last_error}
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        handle, temp_name = tempfile.mkstemp(dir=str(target.parent), suffix=".tmp")
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as stream:
                json.dump(payload, stream, ensure_ascii=False)
            os.replace(temp_name, target)
        except BaseException:
            # Временный файл не должен копиться, если запись не удалась.
            try:
                os.unlink(temp_name)
            except OSError:
                pass
            raise
    except Exception:
        logger.warning("Failed to write reminder heartbeat to %s", target, exc_info=True)


def read_heartbeat(database_path: str | Path) -> dict[str, Any]:
    """Состояние цикла для /healthz. Никогда не бросает исключений."""
    unknown: dict[str, Any] = {
        "reminder_last_run_ts": None,
        "reminder_age_seconds": None,
        "reminder_status": "unknown",
        "reminder_last_error": None,
    }
    target = heartbeat_path(database_path)
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
        timestamp = datetime.fromisoformat(str(raw["ts"]))
    except (OSError, ValueError, KeyError, TypeError):
        return unknown
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=UTC)
    age = (datetime.now(UTC) - timestamp).total_seconds()
    return {
        "reminder_last_run_ts": timestamp.isoformat(),
        "reminder_age_seconds": round(age, 1),
        "reminder_status": "ok" if age <= STALE_AFTER_SECONDS else "stale",
        "reminder_last_error": raw.get("last_error"),
    }
