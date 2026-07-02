#!/usr/bin/env bash
set -euo pipefail

cf_url="${1:-}"
if [[ -z "$cf_url" ]]; then
  echo "usage: $0 https://name.trycloudflare.com" >&2
  exit 2
fi

cf_url="${cf_url%/}"
if [[ ! "$cf_url" =~ ^https://[A-Za-z0-9-]+\.trycloudflare\.com$ ]]; then
  echo "unexpected cloudflare url: $cf_url" >&2
  exit 2
fi
if [[ "$cf_url" == "https://api.trycloudflare.com" ]]; then
  echo "ignoring Cloudflare API URL" >&2
  exit 2
fi

update_env() {
  local file="$1" primary="$2" aliases="$3" tmp
  tmp="$(mktemp)"
  awk -v primary="$primary" -v aliases="$aliases" '
    BEGIN { seen_url=0; seen_aliases=0 }
    /^WEBAPP_URL=/ { print "WEBAPP_URL=" primary; seen_url=1; next }
    /^WEBAPP_URL_ALIASES=/ { print "WEBAPP_URL_ALIASES=" aliases; seen_aliases=1; next }
    { print }
    END {
      if (!seen_url) print "WEBAPP_URL=" primary;
      if (!seen_aliases) print "WEBAPP_URL_ALIASES=" aliases;
    }
  ' "$file" > "$tmp"
  if ! cmp -s "$file" "$tmp"; then
    cp "$file" "$file.bak-alias-$(date +%Y%m%d-%H%M%S)"
    cat "$tmp" > "$file"
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

changed=0
if update_env /opt/tutor-bot/.env "https://g0faqtutorbot.ru" "https://g0faqtutorbot.ru,https://g0faqtutorbot.ru:8443,$cf_url"; then
  changed=1
fi
if update_env /opt/tutor-bot-client-694590118/.env "https://g0faqtutorbot.ru/client-694590118" "https://g0faqtutorbot.ru/client-694590118,https://g0faqtutorbot.ru:8443/client-694590118,$cf_url/client-694590118"; then
  changed=1
fi
if [[ -f /opt/tutor-bot-client-8697163426/.env ]] && update_env /opt/tutor-bot-client-8697163426/.env "https://g0faqtutorbot.ru/client-8697163426" "https://g0faqtutorbot.ru/client-8697163426,https://g0faqtutorbot.ru:8443/client-8697163426,$cf_url/client-8697163426"; then
  changed=1
fi

if [[ "$changed" == "1" ]]; then
  systemctl restart tutor-bot.service tutor-webapp.service tutor-bot-client-694590118.service tutor-webapp-client-694590118.service
  if systemctl list-unit-files tutor-bot-client-8697163426.service >/dev/null 2>&1; then
    systemctl restart tutor-bot-client-8697163426.service tutor-webapp-client-8697163426.service
  fi
fi

python3 - "$cf_url" <<'PY'
from __future__ import annotations

import json
import sqlite3
import sys
import urllib.request
from pathlib import Path

cf_url = sys.argv[1].rstrip("/")

targets = [
    (Path("/opt/tutor-bot/.env"), cf_url),
    (Path("/opt/tutor-bot-client-694590118/.env"), f"{cf_url}/client-694590118"),
    (Path("/opt/tutor-bot-client-8697163426/.env"), f"{cf_url}/client-8697163426"),
]

for env_path, webapp_url in targets:
    if not env_path.exists():
        continue
    env: dict[str, str] = {}
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            env[key] = value.strip().strip("'\"")

    token = env.get("BOT_TOKEN", "")
    admin_ids = [item.strip() for item in env.get("ADMIN_TELEGRAM_IDS", "").split(",") if item.strip()]
    if not token:
        continue

    def known_chat_ids() -> list[int]:
        result: set[int] = set()
        for item in admin_ids:
            try:
                result.add(int(item))
            except ValueError:
                pass
        db_path = env.get("DATABASE_PATH", "")
        if not db_path or not Path(db_path).exists():
            return sorted(result)
        try:
            with sqlite3.connect(db_path) as connection:
                tables = [
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                    )
                ]
                for table in tables:
                    columns = [row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')]
                    for column in ("telegram_id", "tg_id", "chat_id"):
                        if column not in columns:
                            continue
                        query = f'SELECT DISTINCT "{column}" FROM "{table}" WHERE "{column}" IS NOT NULL'
                        for (value,) in connection.execute(query):
                            try:
                                chat_id = int(value)
                            except (TypeError, ValueError):
                                continue
                            if chat_id > 0:
                                result.add(chat_id)
        except Exception as error:
            print(f"{env_path}: failed to collect chat ids from {db_path}: {error}", file=sys.stderr)
        return sorted(result)

    def call(method: str, payload: dict[str, object]) -> None:
        request = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/{method}",
            data=json.dumps(payload, ensure_ascii=False).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            response.read()

    menu_button = {"type": "web_app", "text": "Кабинет", "web_app": {"url": webapp_url}}
    keyboard = {
        "keyboard": [
            [{"text": "Кабинет", "web_app": {"url": webapp_url}}],
            [{"text": "Браузерная версия"}],
            [{"text": "Ученики"}, {"text": "Расписание"}],
            [{"text": "Заявки"}, {"text": "Финансы"}],
            [{"text": "Добавить ученика"}],
            [{"text": "Ожидают оплаты"}],
            [{"text": "Помощь админа"}],
        ],
        "resize_keyboard": True,
    }
    try:
        call("setChatMenuButton", {"menu_button": menu_button})
    except Exception as error:
        print(f"{env_path}: failed to set default menu button: {error}", file=sys.stderr)
    for chat_id in known_chat_ids():
        try:
            call("setChatMenuButton", {"chat_id": chat_id, "menu_button": menu_button})
        except Exception as error:
            print(f"{env_path}: failed to set menu button for {chat_id}: {error}", file=sys.stderr)
    for admin_id in admin_ids:
        try:
            call(
                "sendMessage",
                {
                    "chat_id": int(admin_id),
                    "text": (
                        "Синхронизировал Mini App-кнопки с рабочим Cloudflare-адресом.\n\n"
                        f"{webapp_url}"
                    ),
                    "reply_markup": keyboard,
                },
            )
        except Exception as error:
            print(f"{env_path}: failed to send keyboard to admin {admin_id}: {error}", file=sys.stderr)
PY

printf "%s\n" "$cf_url" > /run/tutor-cloudflare-url
