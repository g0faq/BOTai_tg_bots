#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE_DIR="$ROOT_DIR/template"

if [ "${1:-}" = "" ]; then
  echo "Usage: ./scripts/create_client_copy.sh client-slug [target-dir]"
  exit 1
fi

CLIENT_SLUG="$1"
TARGET_DIR="${2:-$ROOT_DIR/clients/$CLIENT_SLUG}"

case "$CLIENT_SLUG" in
  *[!a-zA-Z0-9._-]*)
    echo "Use only letters, numbers, dots, underscores, and hyphens in client-slug."
    exit 1
    ;;
esac

if [ -e "$TARGET_DIR" ]; then
  echo "Target already exists: $TARGET_DIR"
  exit 1
fi

mkdir -p "$(dirname "$TARGET_DIR")"
rsync -a \
  --exclude '.git' \
  --exclude '.env' \
  --exclude '.venv' \
  --exclude 'venv' \
  --exclude '.DS_Store' \
  --exclude '.idea' \
  --exclude '.pytest_cache' \
  --exclude '.ruff_cache' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude '*.sqlite3' \
  --exclude 'bot.log' \
  --exclude 'webapp.log' \
  "$TEMPLATE_DIR/" "$TARGET_DIR/"

echo "Created client copy: $TARGET_DIR"
echo
echo "Next:"
echo "  cd \"$TARGET_DIR\""
echo "  cp .env.example .env"
echo "  edit .env for this client"
echo "  python3 -m venv .venv"
echo "  source .venv/bin/activate"
echo "  pip install -e '.[dev]'"
echo "  python3 -m unittest discover -s tests"
