#!/usr/bin/env bash
set -euo pipefail

SERVER="${1:-}"

if [ -n "$SERVER" ] && [ "$SERVER" != "--local" ]; then
  ssh "$SERVER" "bash -s -- --local" < "$0"
  exit $?
fi

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

print_section() {
  printf '\n== %s ==\n' "$1"
}

print_section "Host"
hostname || true
date -Is 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ" || true
uname -a || true

print_section "Systemd services"
for service in nginx tutor-bot@g0_faq_bot tutor-bot@sam_zabot tutor-webapp@g0_faq_bot; do
  if command_exists systemctl; then
    printf '%-32s %s\n' "$service" "$(systemctl is-active "$service" 2>/dev/null || true)"
  fi
done

print_section "Listening ports"
if command_exists ss; then
  ss -lntp '( sport = :80 or sport = :443 or sport = :8000 or sport = :8001 )' || true
fi

print_section "Bot env summary"
for env_file in /opt/tutor-bots/g0_faq_bot/.env /opt/tutor-bots/sam_zabot/.env; do
  name="$(basename "$(dirname "$env_file")")"
  if [ ! -f "$env_file" ]; then
    echo "$name: missing $env_file"
    continue
  fi
  echo "$name:"
  awk -F= '
    $1 ~ /^(ADMIN_TELEGRAM_IDS|DATABASE_PATH|WEBAPP_URL|WEBAPP_HOST|WEBAPP_PORT|TIMEZONE)$/ { print "  " $1 "=" $2 }
    $1 == "BOT_TOKEN" {
      if ($2 == "" || $2 ~ /^PASTE_/) print "  BOT_TOKEN=missing"
      else print "  BOT_TOKEN=set"
    }
  ' "$env_file"
done

print_section "Local Mini App"
if command_exists curl; then
  curl -fsS --max-time 5 http://127.0.0.1:8000/healthz || true
  printf '\n'
fi

print_section "Public domain"
if command_exists getent; then
  getent ahostsv4 g0faqtutorbot.ru || true
  getent ahostsv4 www.g0faqtutorbot.ru || true
fi
if command_exists curl; then
  curl -fsSI --max-time 10 https://g0faqtutorbot.ru/healthz || true
fi

print_section "Telegram API"
for env_file in /opt/tutor-bots/g0_faq_bot/.env /opt/tutor-bots/sam_zabot/.env; do
  name="$(basename "$(dirname "$env_file")")"
  if [ ! -f "$env_file" ]; then
    continue
  fi
  token="$(awk -F= '$1 == "BOT_TOKEN" { print $2; exit }' "$env_file")"
  token="${token%\"}"
  token="${token#\"}"
  token="${token%\'}"
  token="${token#\'}"
  if [ -z "$token" ] || [[ "$token" == PASTE_* ]]; then
    echo "$name: BOT_TOKEN is missing"
    continue
  fi
  python3 - "$name" "$token" <<'PY'
from __future__ import annotations

import json
import sys
import urllib.request

name, token = sys.argv[1], sys.argv[2]


def fetch(method: str) -> dict[str, object]:
    with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/{method}", timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


try:
    me = fetch("getMe")
    webhook = fetch("getWebhookInfo")
except Exception as error:
    print(f"{name}: Telegram API check failed: {error}")
    raise SystemExit(0)

username = me.get("result", {}).get("username", "unknown")
webhook_result = webhook.get("result", {})
webhook_url = webhook_result.get("url") or "not set"
pending = webhook_result.get("pending_update_count", "unknown")
print(f"{name}: @{username}, webhook={webhook_url}, pending_updates={pending}")
PY
done

print_section "Recent errors"
if command_exists journalctl; then
  journalctl --no-pager -n 40 -p warning -u tutor-bot@g0_faq_bot -u tutor-bot@sam_zabot -u tutor-webapp@g0_faq_bot -u nginx || true
fi
