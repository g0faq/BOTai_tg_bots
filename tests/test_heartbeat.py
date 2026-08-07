from __future__ import annotations

from pathlib import Path

from tutor_bot.services.heartbeat import (
    heartbeat_path,
    seconds_since_last_update,
    touch_update_heartbeat,
)


def test_no_mark_until_the_first_update(tmp_path: Path) -> None:
    """Пока апдейтов не было, отвечаем «неизвестно», а не «только что»."""
    assert seconds_since_last_update(str(tmp_path / "b.sqlite3")) is None


def test_mark_appears_after_an_update(tmp_path: Path) -> None:
    db = str(tmp_path / "b.sqlite3")
    touch_update_heartbeat(db)
    age = seconds_since_last_update(db)
    assert age is not None
    assert age < 5


def test_mark_lives_next_to_the_database(tmp_path: Path) -> None:
    """Каталог базы переживает перезапуск и виден обоим процессам."""
    db = tmp_path / "data" / "b.sqlite3"
    assert heartbeat_path(str(db)).parent == db.resolve().parent


def test_touch_survives_an_unwritable_path(tmp_path: Path) -> None:
    """Диагностика не имеет права ронять обработку сообщения."""
    unwritable = tmp_path / "b.sqlite3" / "nested" / "b.sqlite3"
    (tmp_path / "b.sqlite3").write_text("not a directory", encoding="utf-8")
    touch_update_heartbeat(str(unwritable))
