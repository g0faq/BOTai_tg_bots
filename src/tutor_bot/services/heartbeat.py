"""Отметка о том, что бот действительно принимает апдейты.

Зачем отдельный файл, а не запись в базу. Бот и веб живут в одном
контейнере, но это разные процессы, и база у них одна на двоих — лишний
писатель там ни к чему. Здесь же нужно хранить ровно одно число, и
подходит время изменения файла: писать нечего, читать нечего, достаточно
тронуть его.

Что это даёт. «Бот не отвечает» распадается на два разных случая: до бота
не доходят сообщения и бот их получил, но не смог ответить. Снаружи они
выглядят одинаково, а чинятся по-разному. Отметка обновляется в момент
приёма апдейта, поэтому свежая отметка означает, что канал от Telegram
до бота живой.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from time import time

UPDATE_HEARTBEAT_NAME = "bot_updates.heartbeat"


def heartbeat_path(database_path: str) -> Path:
    """Кладём рядом с базой: это единственный каталог, который точно
    переживает перезапуск контейнера и доступен обоим процессам."""
    return Path(database_path).resolve().parent / UPDATE_HEARTBEAT_NAME


def touch_update_heartbeat(database_path: str) -> None:
    """Отметить, что апдейт принят. Ошибку глотаем намеренно: диагностика
    не должна ронять обработку сообщения."""
    try:
        path = heartbeat_path(database_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
    except OSError:
        logging.debug("Failed to touch update heartbeat", exc_info=True)


def seconds_since_last_update(database_path: str) -> float | None:
    """Сколько секунд назад бот в последний раз принял апдейт.

    None означает «отметки ещё нет»: либо контейнер только поднялся и
    сообщений не было, либо апдейты не доходят вовсе.
    """
    try:
        return max(0.0, time() - os.stat(heartbeat_path(database_path)).st_mtime)
    except OSError:
        return None
