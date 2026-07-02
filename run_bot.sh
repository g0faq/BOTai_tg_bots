#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ "${ALLOW_LOCAL_BOT_POLLING:-}" != "1" ]; then
  cat >&2 <<'EOF'
Local Telegram polling is disabled.

The production bots must run on the VPS via systemd:
  sudo systemctl restart tutor-bot@g0_faq_bot tutor-bot@sam_zabot

For a short local manual test only:
  ALLOW_LOCAL_BOT_POLLING=1 ./run_bot.sh
EOF
  exit 1
fi

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

.venv/bin/python -m pip install -e .
exec .venv/bin/python -m tutor_bot.main
