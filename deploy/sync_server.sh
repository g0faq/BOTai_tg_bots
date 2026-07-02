#!/usr/bin/env bash
set -euo pipefail

SERVER="${1:-root@5.42.109.83}"
REMOTE_DIR="${REMOTE_DIR:-/tmp/tutor-bots-deploy}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$PROJECT_DIR"

rsync -az --delete \
  --exclude ".git" \
  --exclude ".venv" \
  --exclude ".pytest_cache" \
  --exclude ".ruff_cache" \
  --exclude ".DS_Store" \
  --exclude ".env" \
  --exclude "bot.log" \
  --exclude "*.sqlite3" \
  ./ "$SERVER:$REMOTE_DIR/"

ssh "$SERVER" bash -s <<EOF
set -euo pipefail
cd "$REMOTE_DIR"
bash deploy/install_server.sh
systemctl restart tutor-bot@g0_faq_bot tutor-bot@sam_zabot tutor-webapp@g0_faq_bot
systemctl --no-pager --full status tutor-bot@g0_faq_bot tutor-bot@sam_zabot tutor-webapp@g0_faq_bot nginx
EOF

echo "Synced and restarted server services on $SERVER"
