#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PYTHONPATH="$PROJECT_ROOT/src${PYTHONPATH:+:$PYTHONPATH}"

PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"
G0_DATABASE_PATH="${G0_DATABASE_PATH:-/data/g0_faq_bot.sqlite3}"
SAM_DATABASE_PATH="${SAM_DATABASE_PATH:-/data/sam_zabot.sqlite3}"
RUN_TELEGRAM_BOTS="${RUN_TELEGRAM_BOTS:-0}"
PORT="${PORT:-80}"

: "${PUBLIC_BASE_URL:?Set PUBLIC_BASE_URL to the public HTTPS address}"
: "${G0_BOT_TOKEN:?Set G0_BOT_TOKEN in Amvera secrets}"
: "${SAM_BOT_TOKEN:?Set SAM_BOT_TOKEN in Amvera secrets}"

mkdir -p /data

export BOT_RUNTIME=server
export BOT_TOKEN="$G0_BOT_TOKEN"
export DATABASE_PATH="$G0_DATABASE_PATH"
export WEBAPP_URL="$PUBLIC_BASE_URL"
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
    WEBAPP_URL="$PUBLIC_BASE_URL" \
    python -m tutor_bot.main &
  pids+=("$!")

  env \
    BOT_TOKEN="$SAM_BOT_TOKEN" \
    DATABASE_PATH="$SAM_DATABASE_PATH" \
    WEBAPP_URL="$PUBLIC_BASE_URL/client-694590118" \
    DISABLE_BACKGROUND_REMINDERS=1 \
    python -m tutor_bot.main &
  pids+=("$!")
fi

uvicorn tutor_bot.amvera_app:app \
  --host 0.0.0.0 \
  --port "$PORT" &
pids+=("$!")

wait -n "${pids[@]}"
