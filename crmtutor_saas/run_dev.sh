#!/usr/bin/env bash
set -euo pipefail

export DATABASE_PATH="${DATABASE_PATH:-data/crmtutor.sqlite3}"
export LEGACY_DATABASE_PATH="${LEGACY_DATABASE_PATH:-data/imported_legacy.sqlite3}"
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://127.0.0.1:8001}"
export PYTHONPATH="${PYTHONPATH:-src}"

python -m crmtutor_saas.main
