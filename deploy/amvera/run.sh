#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PYTHONPATH="$PROJECT_ROOT/src${PYTHONPATH:+:$PYTHONPATH}"

PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"
TELEGRAM_WEBAPP_BASE_URL="${TELEGRAM_WEBAPP_BASE_URL:-https://botai-g0faq.amvera.io}"
TELEGRAM_WEBAPP_BASE_URL="${TELEGRAM_WEBAPP_BASE_URL%/}"
# Amvera persistent storage is the only database source after the TimeWeb migration.
G0_DATABASE_PATH="/data/g0_faq_bot.sqlite3"
SAM_DATABASE_PATH="/data/sam_zabot.sqlite3"
# TimeWeb is decommissioned; Amvera is now the single runtime for Telegram polling.
RUN_TELEGRAM_BOTS=1
PORT="${PORT:-80}"

: "${PUBLIC_BASE_URL:?Set PUBLIC_BASE_URL to the public HTTPS address}"
: "${G0_BOT_TOKEN:?Set G0_BOT_TOKEN in Amvera secrets}"
: "${SAM_BOT_TOKEN:?Set SAM_BOT_TOKEN in Amvera secrets}"

mkdir -p /data

G0_BOT_TOKEN_FILE="${G0_BOT_TOKEN_FILE:-/data/g0_bot_token}"
if [[ -s "$G0_BOT_TOKEN_FILE" ]]; then
  G0_BOT_TOKEN="$(tr -d '\r\n' < "$G0_BOT_TOKEN_FILE")"
fi

# Хеш выкаченного коммита для GET /api/build. Если git или .git недоступны,
# остаётся "unknown" — на запуск это не влияет.
if [[ -z "${BUILD_COMMIT:-}" ]]; then
  BUILD_COMMIT="$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
fi
export BUILD_COMMIT

# Какой мини-апп открывает кнопка в боте. По умолчанию новый интерфейс.
# Чтобы вернуть старый — задать WEBAPP_UI=legacy в переменных Amvera и
# перезапустить. Код при этом не меняется, поэтому откат занимает минуту и
# не требует выката. Старый фронт никуда не делся и лежит по адресу «/».
WEBAPP_UI="${WEBAPP_UI:-v2}"
if [[ "$WEBAPP_UI" == "legacy" ]]; then
  G0_WEBAPP_URL="$TELEGRAM_WEBAPP_BASE_URL/"
else
  G0_WEBAPP_URL="$TELEGRAM_WEBAPP_BASE_URL/v2/"
fi

export BOT_RUNTIME=server
export BOT_TOKEN="$G0_BOT_TOKEN"
export DATABASE_PATH="$G0_DATABASE_PATH"
export TELEGRAM_WEBAPP_BASE_URL
export WEBAPP_URL="$G0_WEBAPP_URL"
export WEBAPP_HOST=0.0.0.0
export WEBAPP_PORT="$PORT"

pids=()

stop_children() {
  local pid
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
}

trap stop_children EXIT INT TERM

if [[ "$RUN_TELEGRAM_BOTS" =~ ^(1|true|yes|on)$ ]]; then
  env \
    BOT_TOKEN="$G0_BOT_TOKEN" \
    DATABASE_PATH="$G0_DATABASE_PATH" \
    WEBAPP_URL="$G0_WEBAPP_URL" \
    python -m tutor_bot.main &
  pids+=("$!")

  env \
    BOT_TOKEN="$SAM_BOT_TOKEN" \
    DATABASE_PATH="$SAM_DATABASE_PATH" \
    WEBAPP_URL="$TELEGRAM_WEBAPP_BASE_URL/client-694590118/" \
    DISABLE_BACKGROUND_REMINDERS=1 \
    python -m tutor_bot.main &
  pids+=("$!")
fi

uvicorn tutor_bot.amvera_app:app \
  --host 0.0.0.0 \
  --port "$PORT" &
pids+=("$!")

wait -n "${pids[@]}"
