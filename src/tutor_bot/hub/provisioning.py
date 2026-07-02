from __future__ import annotations

import os
import re
import shlex
import socket
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

from tutor_bot.config import Settings
from tutor_bot.storage.sqlite import SQLiteStorage


APP_ROOT = Path(os.getenv("CRM_APP_ROOT", "/opt/tutor-bot"))
INSTANCE_ROOT_PREFIX = Path(os.getenv("CRM_INSTANCE_ROOT_PREFIX", "/opt"))
SYSTEMD_DIR = Path(os.getenv("CRM_SYSTEMD_DIR", "/etc/systemd/system"))
NGINX_CONFIG = Path(os.getenv("CRM_NGINX_CONFIG", "/etc/nginx/sites-available/tutor-bot"))


@dataclass(frozen=True)
class ProvisionedCRM:
    workspace_path: str
    database_path: str
    webapp_url: str
    webapp_aliases: list[str]
    bot_service: str
    webapp_service: str
    webapp_port: int
    instance_name: str


def should_auto_provision(payload: dict[str, Any]) -> bool:
    return not (payload.get("workspace_path") or payload.get("database_path") or payload.get("webapp_url"))


def provision_crm_instance(
    *,
    settings: Settings,
    bot_token: str,
    bot_username: str,
    admin_id: int,
    admin_username: str,
) -> ProvisionedCRM:
    if admin_id <= 0:
        raise ValueError("Укажи корректный Telegram ID админа")
    if not APP_ROOT.exists():
        raise RuntimeError(f"Код CRM не найден: {APP_ROOT}")

    instance_name = unique_instance_name(admin_id, bot_username)
    workspace = INSTANCE_ROOT_PREFIX / f"tutor-bot-{instance_name}"
    database_path = workspace / "bot.sqlite3"
    webapp_port = find_free_port()
    public_url = public_instance_url(settings, instance_name, prefer_alias=False)
    aliases = public_instance_aliases(settings, instance_name)

    workspace.mkdir(parents=True, exist_ok=True)
    initialize_database(database_path)
    write_env_file(
        workspace / ".env",
        bot_token=bot_token,
        admin_id=admin_id,
        admin_username=admin_username,
        database_path=database_path,
        public_url=public_url,
        aliases=aliases,
        webapp_port=webapp_port,
    )
    write_systemd_units(instance_name, workspace, webapp_port)
    ensure_nginx_location(instance_name, webapp_port)
    reload_services(instance_name)

    return ProvisionedCRM(
        workspace_path=str(workspace),
        database_path=str(database_path),
        webapp_url=public_url,
        webapp_aliases=aliases,
        bot_service=f"tutor-bot-{instance_name}.service",
        webapp_service=f"tutor-webapp-{instance_name}.service",
        webapp_port=webapp_port,
        instance_name=instance_name,
    )


def unique_instance_name(admin_id: int, bot_username: str = "") -> str:
    source = (bot_username or "").strip().lstrip("@") or str(admin_id)
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", source).strip("-_").lower()
    slug = slug or str(admin_id)
    if not slug.startswith("client-"):
        slug = f"client-{slug}"
    for index in range(1, 100):
        candidate = slug if index == 1 else f"{slug}-{index}"
        if instance_name_available(candidate):
            return candidate
    raise RuntimeError("Не удалось подобрать уникальное имя инстанса CRM")


def instance_name_available(instance_name: str) -> bool:
    workspace = INSTANCE_ROOT_PREFIX / f"tutor-bot-{instance_name}"
    bot_unit = SYSTEMD_DIR / f"tutor-bot-{instance_name}.service"
    webapp_unit = SYSTEMD_DIR / f"tutor-webapp-{instance_name}.service"
    if workspace.exists() or bot_unit.exists() or webapp_unit.exists():
        return False
    if NGINX_CONFIG.exists() and f"location /{instance_name}/" in NGINX_CONFIG.read_text(encoding="utf-8"):
        return False
    return True


def public_instance_url(settings: Settings, instance_name: str, *, prefer_alias: bool) -> str:
    roots = public_roots(settings)
    root = roots[-1] if prefer_alias and roots else roots[0]
    return f"{root}/{instance_name}"


def public_instance_aliases(settings: Settings, instance_name: str) -> list[str]:
    return [f"{root}/{instance_name}" for root in public_roots(settings)]


def public_roots(settings: Settings) -> list[str]:
    urls = [settings.webapp_url, *(settings.webapp_url_aliases or [])]
    roots: list[str] = []
    seen: set[str] = set()
    for url in urls:
        parsed = urlparse((url or "").strip())
        if not parsed.scheme or not parsed.netloc:
            continue
        root = urlunparse((parsed.scheme, parsed.netloc, "", "", "", "")).rstrip("/")
        if root and root not in seen:
            seen.add(root)
            roots.append(root)
    roots = sorted(roots, key=lambda item: ("sslip.io" in item, item))
    return roots or ["https://g0faqtutorbot.ru"]


def initialize_database(database_path: Path) -> None:
    storage = SQLiteStorage(database_path)
    storage.close()


def write_env_file(
    path: Path,
    *,
    bot_token: str,
    admin_id: int,
    admin_username: str,
    database_path: Path,
    public_url: str,
    aliases: list[str],
    webapp_port: int,
) -> None:
    teacher_chat_url = f"https://t.me/{admin_username.lstrip('@')}" if admin_username else ""
    content = "\n".join(
        [
            f"BOT_TOKEN={bot_token}",
            f"ADMIN_TELEGRAM_IDS={admin_id}",
            f"TEACHER_CHAT_URL={teacher_chat_url}",
            f"DATABASE_PATH={database_path}",
            "TIMEZONE=Europe/Moscow",
            "DEFAULT_LESSON_PRICE=1500",
            "DEFAULT_LESSON_DURATION_MINUTES=90",
            "DEFAULT_PAYMENT_PACKAGE_SIZE=4",
            "LOW_BALANCE_THRESHOLD=1",
            "REMINDER_MINUTES_BEFORE_LESSON=5",
            "WORKING_DAYS=1,2,3,4,5,6,7",
            "WORKING_START=7:00",
            "WORKING_END=23:00",
            "SLOT_STEP_MINUTES=30",
            f"WEBAPP_URL={public_url}",
            f"WEBAPP_URL_ALIASES={','.join(aliases)}",
            "PAYMENT_DETAILS_TEXT=Реквизиты для оплаты преподаватель пришлет отдельно.",
            "STICKER_SPAM_LIMIT=3",
            "STICKER_SPAM_WINDOW_SECONDS=10",
            "STICKER_SPAM_BLOCK_SECONDS=60",
            "STICKER_SPAM_WARNING_COOLDOWN_SECONDS=30",
            f"WEBAPP_PORT={webapp_port}",
            f"ENV_FILE={path}",
            f"PYTHONPATH={APP_ROOT / 'src'}",
            "",
        ]
    )
    path.write_text(content, encoding="utf-8")
    path.chmod(0o600)


def write_systemd_units(instance_name: str, workspace: Path, webapp_port: int) -> None:
    bot_unit = SYSTEMD_DIR / f"tutor-bot-{instance_name}.service"
    webapp_unit = SYSTEMD_DIR / f"tutor-webapp-{instance_name}.service"
    env_file = workspace / ".env"
    bot_unit.write_text(
        f"""[Unit]
Description=Tutor Telegram Bot {instance_name}
After=network.target

[Service]
Type=simple
WorkingDirectory={APP_ROOT}
EnvironmentFile={env_file}
Environment=ENV_FILE={env_file}
Environment=PYTHONPATH={APP_ROOT / 'src'}
Environment=PYTHONUNBUFFERED=1
ExecStart={APP_ROOT / '.venv/bin/python'} -m tutor_bot.main
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
""",
        encoding="utf-8",
    )
    webapp_unit.write_text(
        f"""[Unit]
Description=Tutor Telegram Mini App {instance_name}
After=network.target

[Service]
Type=simple
WorkingDirectory={APP_ROOT}
EnvironmentFile={env_file}
Environment=ENV_FILE={env_file}
Environment=PYTHONPATH={APP_ROOT / 'src'}
Environment=PYTHONUNBUFFERED=1
ExecStart={APP_ROOT / '.venv/bin/python'} -m uvicorn tutor_bot.webapp:app --host 127.0.0.1 --port {webapp_port}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
""",
        encoding="utf-8",
    )


def ensure_nginx_location(instance_name: str, webapp_port: int) -> None:
    if not NGINX_CONFIG.exists():
        raise RuntimeError(f"Nginx config не найден: {NGINX_CONFIG}")
    text = NGINX_CONFIG.read_text(encoding="utf-8")
    location = nginx_location_block(instance_name, webapp_port)
    if f"location /{instance_name}/" in text:
        return
    marker = "\n    location / {\n"
    if marker not in text:
        raise RuntimeError("Не нашел основной location / в nginx config")
    text = text.replace(marker, f"\n{location}\n{marker}", 1)
    NGINX_CONFIG.write_text(text, encoding="utf-8")
    run(["nginx", "-t"])
    run(["systemctl", "reload", "nginx"])


def nginx_location_block(instance_name: str, webapp_port: int) -> str:
    escaped = re.sub(r"[^a-zA-Z0-9_-]", "", instance_name)
    return f"""    location = /{escaped} {{
        return 301 /{escaped}/;
    }}

    location /{escaped}/ {{
        proxy_pass http://127.0.0.1:{webapp_port}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}
"""


def reload_services(instance_name: str) -> None:
    run(["systemctl", "daemon-reload"])
    run(["systemctl", "enable", "--now", f"tutor-webapp-{instance_name}.service"])
    run(["systemctl", "enable", "--now", f"tutor-bot-{instance_name}.service"])


def find_free_port(start: int = 8011, end: int = 8999) -> int:
    reserved = configured_ports()
    for port in range(start, end + 1):
        if port not in reserved and is_port_free(port):
            return port
    raise RuntimeError("Не нашел свободный порт для нового Mini App")


def is_port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) != 0


def configured_ports() -> set[int]:
    ports: set[int] = set()
    for path in SYSTEMD_DIR.glob("tutor-webapp*.service"):
        ports.update(int(item) for item in re.findall(r"--port\s+(\d+)", path.read_text(encoding="utf-8", errors="ignore")))
    if NGINX_CONFIG.exists():
        ports.update(int(item) for item in re.findall(r"127\.0\.0\.1:(\d+)", NGINX_CONFIG.read_text(encoding="utf-8")))
    return ports


def run(command: list[str]) -> None:
    try:
        subprocess.run(command, check=True, text=True, capture_output=True)
    except subprocess.CalledProcessError as exc:
        cmd = " ".join(shlex.quote(part) for part in command)
        detail = (exc.stderr or exc.stdout or "").strip()
        raise RuntimeError(f"Команда не выполнилась: {cmd}. {detail}") from exc
