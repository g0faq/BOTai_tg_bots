#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

.venv/bin/python -m pip install -e '.[dev]'
exec .venv/bin/python -m uvicorn tutor_bot.webapp:app --host 127.0.0.1 --port 8000
