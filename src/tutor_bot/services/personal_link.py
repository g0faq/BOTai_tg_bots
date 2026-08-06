"""Постоянная персональная ссылка на кабинет.

Ссылка выдаётся ученику и родителю отдельно и не меняется от вызова к
вызову: токен вычисляется детерминированно из токена бота, роли и id
ученика. Хранить сырой токен не нужно — он воспроизводится в любой момент,
а в базе лежит только его хеш, как и у ссылок, выдаваемых из карточки
ученика.

Свойства:

* одна и та же ссылка при каждом нажатии кнопки — её можно сохранить в
  закладки, она не протухает;
* у ученика и родителя ссылки разные: заходят они в один кабинет, но под
  своей ролью и со своими правами;
* без токена бота подобрать её нельзя — это HMAC, а не порядковый номер.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
from datetime import UTC, timedelta

from tutor_bot.config import Settings

#: Срок жизни и самой ссылки, и сессии за ней. Практически «постоянная».
PERMANENT_DAYS = 3650
SESSION_DAYS = 365


def personal_token(settings: Settings, role: str, student_id: int) -> str:
    """Детерминированный токен доступа для пары «роль + ученик»."""
    message = f"browser-invite:v1:{role}:{int(student_id)}".encode()
    digest = hmac.new(settings.bot_token.encode(), message, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def hash_browser_token(token: str) -> str:
    """Тот же хеш, что и у ссылок из карточки ученика (webapp.py)."""
    return hashlib.sha256(token.encode()).hexdigest()


def personal_link_url(settings: Settings, token: str) -> str:
    """Ссылка входа строится от корня, а не от адреса мини-аппа."""
    return f"{settings.webapp_url.rstrip('/')}/login/{token}"


def ensure_personal_invite(db, settings: Settings, role: str, student_id: int, now) -> str:
    """Возвращает токен, заводя запись приглашения, если её ещё нет.

    Повторные вызовы не создают дублей: токен один и тот же, поэтому и хеш
    совпадает. Если запись есть, но срок подходит к концу, продлеваем.
    """
    token = personal_token(settings, role, student_id)
    token_hash = hash_browser_token(token)
    # Срок хранится со смещением: маршрут входа сравнивает его с
    # datetime.now(UTC), и наивное время роняет сравнение.
    base = now if now.tzinfo else now.replace(tzinfo=UTC)
    expires_at = base + timedelta(days=PERMANENT_DAYS)

    existing = db.get_browser_invite(token_hash)
    if existing is None:
        db.add_browser_invite(
            token_hash=token_hash,
            student_id=int(student_id),
            role=role,
            expires_at=expires_at,
            session_days=SESSION_DAYS,
        )
    return token


# --------------------------------------------------------------------------- #
# Ссылка чата: работает до регистрации
# --------------------------------------------------------------------------- #
#
# Приглашение из browser_invites требует существующего ученика, а у нового
# пользователя профиля ещё нет. Поэтому ссылка чата не хранится в базе
# вовсе: telegram_id едет прямо в токене, а рядом — подпись. Сервер
# пересчитывает подпись и получает id обратно.
#
# Что это даёт: одна и та же кнопка работает и до регистрации (открывает
# анкету, привязанную к нужному чату), и после неё (открывает кабинет).

CHAT_TOKEN_VERSION = "c1"


def _chat_signature(settings: Settings, telegram_id: int) -> str:
    message = f"chat:{CHAT_TOKEN_VERSION}:{int(telegram_id)}".encode()
    digest = hmac.new(settings.bot_token.encode(), message, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")[:32]


def chat_token(settings: Settings, telegram_id: int) -> str:
    """Постоянный токен чата: «<id>.<подпись>»."""
    return f"{int(telegram_id)}.{_chat_signature(settings, telegram_id)}"


def verify_chat_token(settings: Settings, token: str) -> int | None:
    """Возвращает telegram_id, если подпись верна. Иначе None."""
    raw = (token or "").strip()
    if "." not in raw:
        return None
    head, _, signature = raw.partition(".")
    if not head.isdigit():
        return None
    telegram_id = int(head)
    if not hmac.compare_digest(signature, _chat_signature(settings, telegram_id)):
        return None
    return telegram_id


def chat_link_url(settings: Settings, telegram_id: int) -> str:
    return f"{settings.webapp_url.rstrip('/')}/login/chat/{chat_token(settings, telegram_id)}"
