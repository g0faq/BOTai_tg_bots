from __future__ import annotations

import hashlib
import secrets
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from tutor_bot.config import Settings, load_dotenv, load_settings
from tutor_bot.hub.provisioning import provision_crm_instance, should_auto_provision
from tutor_bot.hub.stats import collect_crm_stats
from tutor_bot.hub.storage import HubStorage
from tutor_bot.webapp import verify_init_data

STATIC_DIR = Path(__file__).resolve().parent.parent / "hub_static"
APP_VERSION = "20260613-hub-v20"
HUB_SESSION_COOKIE = "g0faq_hub_session"


class HubState:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.db = HubStorage(settings.hub_database_path)


class ManagedBotCreate(BaseModel):
    bot_token: str = Field(min_length=20)
    tutor_name: str = ""
    tutor_telegram_username: str = ""
    admin_telegram_id: int | None = None
    tutor_chat_id: int | None = None
    status: str = "active"
    plan_name: str = ""
    plan_price: int = Field(default=0, ge=0)
    last_payment_at: str | None = None
    next_payment_at: str | None = None
    payment_status: str = "unpaid"
    notes: str = ""
    workspace_path: str = ""
    database_path: str = ""
    webapp_url: str = ""


class ManagedBotUpdate(BaseModel):
    tutor_name: str | None = None
    tutor_telegram_username: str | None = None
    tutor_chat_id: int | None = None
    status: str | None = None
    plan_name: str | None = None
    plan_price: int | None = Field(default=None, ge=0)
    last_payment_at: str | None = None
    next_payment_at: str | None = None
    payment_status: str | None = None
    notes: str | None = None
    workspace_path: str | None = None
    database_path: str | None = None
    webapp_url: str | None = None
    confirm: bool = False


class StatusUpdate(BaseModel):
    status: str
    confirm: bool = False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hub_base_url(settings: Settings, request: Request | None = None) -> str:
    if request is not None:
        scheme = request.headers.get("x-forwarded-proto") or request.url.scheme
        host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
        if host:
            return f"{scheme}://{host}/hub".rstrip("/")
    return settings.hub_webapp_url.rstrip("/")


def unique_urls(urls: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for url in urls:
        normalized = (url or "").strip().rstrip("/")
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def url_variants(primary_url: str, alias_roots: list[str] | None = None) -> list[str]:
    primary_url = (primary_url or "").strip()
    if not primary_url:
        return []
    primary = urlparse(primary_url)
    if not primary.scheme or not primary.netloc:
        return unique_urls([primary_url])
    path = primary.path or "/"
    query = primary.query
    urls = [urlunparse((primary.scheme, primary.netloc, path, "", query, ""))]
    for alias in alias_roots or []:
        parsed = urlparse(alias)
        if parsed.scheme and parsed.netloc:
            urls.append(urlunparse((parsed.scheme, parsed.netloc, path, "", query, "")))
    return unique_urls(urls)


def bot_webapp_urls(settings: Settings, bot: dict[str, Any]) -> list[str]:
    return url_variants(str(bot.get("webapp_url") or ""), settings.webapp_url_aliases or [])


def recommended_bot_url(settings: Settings, bot: dict[str, Any]) -> str:
    urls = bot_webapp_urls(settings, bot)
    return urls[-1] if urls else ""


def hub_webapp_urls(settings: Settings, request: Request | None = None) -> list[str]:
    return unique_urls(
        [
            hub_base_url(settings, request),
            settings.hub_webapp_url,
            *(settings.hub_webapp_url_aliases or []),
        ]
    )


def recommended_hub_url(settings: Settings, request: Request | None = None) -> str:
    urls = hub_webapp_urls(settings, request)
    return urls[-1] if urls else ""


def allow_local_dev_auth(request: Request) -> bool:
    return (request.url.hostname or "") in {"127.0.0.1", "localhost", "::1"}


def require_confirm(action: str, confirmed: bool) -> None:
    if action in {"disabled", "paused", "overdue", "delete", "tariff", "payment_date"} and not confirmed:
        raise HTTPException(status_code=409, detail="Нужно подтвердить опасное действие")


def validate_status(status: str) -> str:
    allowed = {"active", "paused", "disabled", "overdue"}
    if status not in allowed:
        raise HTTPException(status_code=400, detail="Неверный статус доступа")
    return status


def validate_payment_status(status: str) -> str:
    allowed = {"paid", "due_soon", "overdue", "unpaid"}
    if status not in allowed:
        raise HTTPException(status_code=400, detail="Неверный статус оплаты")
    return status


def create_app(settings: Settings | None = None) -> FastAPI:
    if settings is None:
        load_dotenv()
        settings = load_settings()
    state = HubState(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        try:
            yield
        finally:
            state.db.close()

    app = FastAPI(title="g0faq Hub", lifespan=lifespan)
    app.state.hub_state = state
    app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="hub-assets")

    @app.middleware("http")
    async def no_cache(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-App-Version"] = APP_VERSION
        if request.url.path == "/" or request.url.path.startswith("/api/") or request.url.path.startswith("/assets/"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

    def current_admin(
        request: Request,
        x_telegram_init_data: str | None = Header(default=None),
        x_dev_telegram_id: str | None = Header(default=None),
    ) -> int:
        admin_ids = set(state.settings.master_admin_ids or state.settings.admin_telegram_ids)
        if x_telegram_init_data:
            if not state.settings.hub_bot_token:
                raise HTTPException(status_code=503, detail="Hub bot token is not configured")
            user = verify_init_data(x_telegram_init_data, state.settings.hub_bot_token)
            user_id = int(user["id"])
            if user_id in admin_ids:
                return user_id
            raise HTTPException(status_code=403, detail="Нет доступа к g0faq Hub")
        cookie = request.cookies.get(HUB_SESSION_COOKIE)
        if cookie:
            session = state.db.get_browser_session(hash_token(cookie))
            if session and int(session["owner_user_id"]) in admin_ids:
                state.db.touch_browser_session(int(session["id"]))
                return int(session["owner_user_id"])
        if x_dev_telegram_id and allow_local_dev_auth(request) and int(x_dev_telegram_id) in admin_ids:
            return int(x_dev_telegram_id)
        raise HTTPException(status_code=401, detail="Открой Hub из Telegram или по личной ссылке")

    admin_dep = Depends(current_admin)

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(
            STATIC_DIR / "index.html",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate", "X-App-Version": APP_VERSION},
        )

    @app.get("/login/{token}")
    def accept_browser_invite(token: str) -> RedirectResponse:
        invite = state.db.get_browser_invite(hash_token(token))
        admin_ids = set(state.settings.master_admin_ids or state.settings.admin_telegram_ids)
        if not invite or int(invite["owner_user_id"]) not in admin_ids:
            raise HTTPException(status_code=404, detail="Ссылка доступа не найдена")
        session_token = secrets.token_urlsafe(32)
        state.db.add_browser_session(hash_token(session_token), int(invite["owner_user_id"]))
        response = RedirectResponse(url="/hub/", status_code=303)
        response.set_cookie(
            HUB_SESSION_COOKIE,
            session_token,
            max_age=3650 * 24 * 60 * 60,
            httponly=True,
            secure=hub_base_url(state.settings).startswith("https://"),
            samesite="lax",
            path="/hub",
        )
        return response

    @app.get("/api/me")
    def me(admin_id: int = admin_dep) -> dict[str, Any]:
        return {"admin_id": admin_id, "version": APP_VERSION}

    @app.get("/api/overview")
    def overview(_: int = admin_dep) -> dict[str, Any]:
        bots = enrich_bots(state)
        return {"summary": state.db.overview(), "bots": bots}

    @app.get("/api/bots")
    def bots(_: int = admin_dep) -> dict[str, Any]:
        return {"bots": enrich_bots(state)}

    @app.post("/api/bots")
    def add_bot(payload: ManagedBotCreate, admin_id: int = admin_dep) -> dict[str, Any]:
        info = telegram_get_me(payload.bot_token)
        data = payload.model_dump()
        target_admin_id = payload.admin_telegram_id or payload.tutor_chat_id
        tutor_username = (payload.tutor_telegram_username or "").strip().lstrip("@")
        tutor_name = (payload.tutor_name or tutor_username or info.get("first_name") or info.get("username") or "Репетитор").strip()
        if should_auto_provision(data):
            if not target_admin_id:
                raise HTTPException(status_code=400, detail="Укажи Telegram ID админа")
            try:
                provisioned = provision_crm_instance(
                    settings=state.settings,
                    bot_token=payload.bot_token,
                    bot_username=str(info.get("username") or ""),
                    admin_id=int(target_admin_id),
                    admin_username=tutor_username,
                )
            except (RuntimeError, ValueError) as exc:
                raise HTTPException(status_code=500, detail=str(exc)) from exc
            data.update(
                {
                    "tutor_name": tutor_name,
                    "tutor_chat_id": int(target_admin_id),
                    "workspace_path": provisioned.workspace_path,
                    "database_path": provisioned.database_path,
                    "webapp_url": provisioned.webapp_url,
                    "notes": "\n".join(
                        item
                        for item in [
                            data.get("notes") or "",
                            f"Автосоздано Hub: {provisioned.instance_name}",
                            f"Services: {provisioned.bot_service}, {provisioned.webapp_service}",
                            f"Port: {provisioned.webapp_port}",
                        ]
                        if item
                    ),
                }
            )
        else:
            data["tutor_name"] = tutor_name
            if target_admin_id and not data.get("tutor_chat_id"):
                data["tutor_chat_id"] = int(target_admin_id)
        bot = state.db.upsert_managed_bot(
            {
                **data,
                "owner_user_id": admin_id,
                "bot_id": int(info["id"]),
                "bot_username": info.get("username") or "",
                "bot_name": info.get("first_name") or info.get("username") or "CRM bot",
            }
        )
        snapshot = refresh_bot_stats(state, int(bot["id"]))
        set_bot_menu_button(payload.bot_token, recommended_bot_url(state.settings, bot))
        return {"bot": attach_stats(bot, snapshot, state.settings)}

    @app.get("/api/bots/{bot_id}")
    def bot_detail(bot_id: int, _: int = admin_dep) -> dict[str, Any]:
        bot = state.db.get_managed_bot(bot_id)
        if bot is None:
            raise HTTPException(status_code=404, detail="Бот не найден")
        return {"bot": attach_stats(bot, state.db.latest_stats(bot_id), state.settings)}

    @app.patch("/api/bots/{bot_id}")
    def update_bot(bot_id: int, payload: ManagedBotUpdate, _: int = admin_dep) -> dict[str, Any]:
        updates = {key: value for key, value in payload.model_dump().items() if value is not None and key != "confirm"}
        if "status" in updates:
            updates["status"] = validate_status(str(updates["status"]))
            require_confirm(str(updates["status"]), payload.confirm)
        if "payment_status" in updates:
            updates["payment_status"] = validate_payment_status(str(updates["payment_status"]))
        if "plan_price" in updates or "plan_name" in updates:
            require_confirm("tariff", payload.confirm)
        if "next_payment_at" in updates:
            require_confirm("payment_date", payload.confirm)
        bot = state.db.update_managed_bot(bot_id, updates)
        apply_access_state(bot)
        if "webapp_url" in updates:
            bot_with_token = state.db.get_managed_bot_with_token(bot_id)
            if bot_with_token:
                set_bot_menu_button(str(bot_with_token.get("bot_token") or ""), recommended_bot_url(state.settings, bot))
        return {"bot": attach_stats(bot, state.db.latest_stats(bot_id), state.settings)}

    @app.post("/api/bots/{bot_id}/status")
    def change_status(bot_id: int, payload: StatusUpdate, _: int = admin_dep) -> dict[str, Any]:
        status = validate_status(payload.status)
        require_confirm(status, payload.confirm)
        bot = state.db.update_managed_bot(bot_id, {"status": status})
        apply_access_state(bot)
        return {"bot": attach_stats(bot, state.db.latest_stats(bot_id), state.settings)}

    @app.post("/api/bots/{bot_id}/refresh-stats")
    def refresh_stats(bot_id: int, _: int = admin_dep) -> dict[str, Any]:
        bot = state.db.get_managed_bot(bot_id)
        if bot is None:
            raise HTTPException(status_code=404, detail="Бот не найден")
        snapshot = refresh_bot_stats(state, bot_id)
        return {"bot": attach_stats(bot, snapshot, state.settings)}

    @app.delete("/api/bots/{bot_id}")
    def delete_bot(bot_id: int, confirm: bool = False, _: int = admin_dep) -> dict[str, Any]:
        require_confirm("delete", confirm)
        state.db.delete_managed_bot(bot_id)
        return {"deleted": True, "bot_id": bot_id}

    @app.post("/api/browser-invites")
    def browser_invite(request: Request, admin_id: int = admin_dep) -> dict[str, str]:
        token = secrets.token_urlsafe(32)
        state.db.add_browser_invite(hash_token(token), admin_id)
        return {"url": f"{hub_base_url(state.settings, request)}/login/{token}"}

    @app.get("/api/hub-links")
    def hub_links(request: Request, _: int = admin_dep) -> dict[str, Any]:
        urls = hub_webapp_urls(state.settings, request)
        return {
            "title": "g0faq Hub",
            "recommended_url": urls[-1] if urls else "",
            "urls": urls,
            "botfather_instruction": "BotFather → Bot Settings → Menu Button → Configure menu button → вставь URL.",
        }

    @app.get("/api/bots/{bot_id}/botfather-links")
    def botfather_links(bot_id: int, _: int = admin_dep) -> dict[str, Any]:
        bot = state.db.get_managed_bot(bot_id)
        if bot is None:
            raise HTTPException(status_code=404, detail="Бот не найден")
        urls = bot_webapp_urls(state.settings, bot)
        return {
            "title": bot.get("bot_name") or bot.get("bot_username") or "CRM bot",
            "recommended_url": urls[-1] if urls else "",
            "urls": urls,
            "botfather_instruction": "BotFather → Bot Settings → Menu Button → Configure menu button → вставь URL.",
        }

    @app.post("/api/bots/{bot_id}/menu-button")
    def set_menu_button(bot_id: int, _: int = admin_dep) -> dict[str, Any]:
        bot = state.db.get_managed_bot_with_token(bot_id)
        if bot is None:
            raise HTTPException(status_code=404, detail="Бот не найден")
        safe_bot = state.db.get_managed_bot(bot_id) or {}
        url = recommended_bot_url(state.settings, safe_bot)
        set_bot_menu_button(str(bot.get("bot_token") or ""), url)
        return {"ok": True, "url": url}

    return app


def telegram_get_me(bot_token: str) -> dict[str, Any]:
    url = f"https://api.telegram.org/bot{bot_token}/getMe"
    try:
        response = httpx.get(url, timeout=12)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Telegram token не прошел проверку") from exc
    if not payload.get("ok") or not payload.get("result"):
        raise HTTPException(status_code=400, detail="Telegram token не прошел проверку")
    return dict(payload["result"])


def enrich_bots(state: HubState) -> list[dict[str, Any]]:
    return [attach_stats(bot, state.db.latest_stats(int(bot["id"])), state.settings) for bot in state.db.list_managed_bots()]


def attach_stats(bot: dict[str, Any], stats: dict[str, Any] | None, settings: Settings | None = None) -> dict[str, Any]:
    data = dict(bot)
    data["stats"] = stats or {
        "students_count": 0,
        "lessons_today": 0,
        "lessons_week": 0,
        "income_today": 0,
        "income_week": 0,
        "income_month": 0,
        "expected_payments": 0,
        "debts_amount": 0,
        "homework_count": 0,
        "last_activity_at": None,
    }
    username = data.get("tutor_telegram_username") or ""
    data["chat_url"] = f"https://t.me/{username.lstrip('@')}" if username else ""
    if settings is not None:
        urls = bot_webapp_urls(settings, data)
        data["webapp_urls"] = urls
        data["botfather_url"] = urls[-1] if urls else ""
    return data


def set_bot_menu_button(bot_token: str, webapp_url: str) -> None:
    if not bot_token or not webapp_url:
        return
    url = f"https://api.telegram.org/bot{bot_token}/setChatMenuButton"
    payload = {
        "menu_button": {
            "type": "web_app",
            "text": "Mini App",
            "web_app": {"url": webapp_url},
        }
    }
    try:
        response = httpx.post(url, json=payload, timeout=12)
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Не удалось выставить кнопку меню Telegram") from exc
    if not data.get("ok"):
        raise HTTPException(status_code=502, detail="Не удалось выставить кнопку меню Telegram")


def refresh_bot_stats(state: HubState, bot_id: int) -> dict[str, Any]:
    bot = state.db.get_managed_bot(bot_id)
    if bot is None:
        raise HTTPException(status_code=404, detail="Бот не найден")
    result = collect_crm_stats(bot.get("database_path") or "")
    if result.available:
        return state.db.add_stats_snapshot(bot_id, result.data)
    latest = state.db.latest_stats(bot_id)
    if latest:
        latest["stats_available"] = False
        latest["stats_error"] = result.error
        return latest
    empty = state.db.add_stats_snapshot(bot_id, {})
    empty["stats_available"] = False
    empty["stats_error"] = result.error
    return empty


def apply_access_state(bot: dict[str, Any]) -> None:
    database_path = bot.get("database_path") or ""
    if not database_path:
        return
    status = bot.get("status") or "active"
    message = "Доступ временно ограничен. Свяжитесь с владельцем сервиса."
    try:
        import sqlite3

        conn = sqlite3.connect(database_path)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS service_access (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                status TEXT NOT NULL DEFAULT 'active',
                message TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            INSERT INTO service_access(id, status, message, updated_at)
            VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET status = excluded.status, message = excluded.message, updated_at = excluded.updated_at
            """,
            (status, "" if status == "active" else message, datetime.now(UTC).isoformat()),
        )
        conn.commit()
        conn.close()
    except sqlite3.Error:
        return


app = create_app()
