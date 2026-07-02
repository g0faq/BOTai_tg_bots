# Server Handoff For Another Agent

Last updated: June 18, 2026

This file is the practical handoff for connecting to and operating the production VPS for the tutor bots.

## Server

- Public host: `5.42.109.83`
- SSH user: `root`
- Current hostname on the server: `msk-1-vm-js3z`

## SSH Access From This Mac

Working SSH key on this machine:

- `~/.ssh/tutor_bot_timeweb_ed25519`

Working proxy helper on this machine:

- `/tmp/ssh_banner_first_proxy.py`

Current working proxy target:

- `192.168.0.100`

Canonical SSH command:

```bash
ssh -i ~/.ssh/tutor_bot_timeweb_ed25519 \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -o ConnectTimeout=60 \
  -o ServerAliveInterval=10 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=accept-new \
  -o ProxyCommand='python3 /tmp/ssh_banner_first_proxy.py %h %p 192.168.0.100' \
  root@5.42.109.83
```

Canonical `rsync` SSH wrapper:

```bash
SSH_RSH="ssh -i ~/.ssh/tutor_bot_timeweb_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=60 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=accept-new -o ProxyCommand='python3 /tmp/ssh_banner_first_proxy.py %h %p 192.168.0.100'"
```

## App Layout On Server

Shared code:

- `/opt/tutor-bots/app`

Instance env files:

- `/opt/tutor-bots/g0_faq_bot/.env`
- `/opt/tutor-bots/sam_zabot/.env`

Important note:

- `g0_faq_bot` still uses a legacy database path from its env:
  - `/opt/tutor-bot/bot.sqlite3`
- `sam_zabot` uses:
  - `/opt/tutor-bots/sam_zabot/bot.sqlite3`

## Public URLs

`g0_faq_bot`:

- Main site: `https://g0faqtutorbot.ru`
- Local webapp port: `127.0.0.1:8000`

`sam_zabot`:

- Main student/admin Mini App path: `https://g0faqtutorbot.ru/client-694590118`
- Local webapp port: `127.0.0.1:8001`

## Current App Version

As of June 18, 2026 both webapps report:

- `20260616-student-detail-v65`

Quick check:

```bash
curl -fsS http://127.0.0.1:8000/api/version
curl -fsS http://127.0.0.1:8001/api/version
curl -fsS https://g0faqtutorbot.ru/api/version
curl -fsS https://g0faqtutorbot.ru/client-694590118/api/version
```

## Systemd Services

Primary live services:

- `tutor-bot@g0_faq_bot`
- `tutor-webapp@g0_faq_bot`
- `tutor-bot@sam_zabot`
- `tutor-webapp@sam_zabot`
- `nginx`

Check them:

```bash
systemctl is-active tutor-bot@g0_faq_bot tutor-webapp@g0_faq_bot tutor-bot@sam_zabot tutor-webapp@sam_zabot nginx
```

Restart them:

```bash
systemctl restart tutor-bot@g0_faq_bot tutor-webapp@g0_faq_bot
systemctl restart tutor-bot@sam_zabot tutor-webapp@sam_zabot
```

## Important Legacy Context

There are legacy directories on the server:

- `/opt/tutor-bot`
- `/opt/tutor-bot-client-1023669797`
- `/opt/tutor-bot-client-694590118`
- `/opt/tutor-bot-client-8697163426`

Important:

- `sam_zabot` previously lived in the legacy client path `694590118`.
- The legacy services `tutor-bot-client-694590118` and `tutor-webapp-client-694590118` were disabled because they conflicted with the new `sam_zabot` systemd services.
- Do **not** re-enable those legacy services unless you intentionally want to roll back.

Expected status now:

- `tutor-bot-client-694590118` -> `inactive`
- `tutor-webapp-client-694590118` -> `inactive`

## Known Mini App Routing Detail

For `sam_zabot`, the stable Mini App URL is:

- `https://g0faqtutorbot.ru/client-694590118`

Do not point Telegram menu buttons or student reply keyboards to the old temporary Cloudflare URL.

Related fixes already applied in code:

- Telegram main Mini App URL now uses `WEBAPP_URL`, not the last alias.
- Browser invite primary link now prefers the first stable URL.
- On bot startup, the code rewrites chat menu buttons for known users to the stable URL.

## Current Env Summary

`g0_faq_bot`:

- `DATABASE_PATH=/opt/tutor-bot/bot.sqlite3`
- `WEBAPP_URL=https://g0faqtutorbot.ru`
- `TIMEZONE=Europe/Moscow`

`sam_zabot`:

- `DATABASE_PATH=/opt/tutor-bots/sam_zabot/bot.sqlite3`
- `WEBAPP_URL=https://g0faqtutorbot.ru/client-694590118`
- `WEBAPP_PORT=8001`
- `TIMEZONE=Europe/Moscow`

Do not commit or print raw bot tokens. They are stored in the env files above.

## Deployment From This Repo

From this workspace:

```bash
./deploy/sync_server.sh root@5.42.109.83
```

That script syncs code and restarts:

- `tutor-bot@g0_faq_bot`
- `tutor-bot@sam_zabot`
- `tutor-webapp@g0_faq_bot`

Important:

- It does **not** restart `tutor-webapp@sam_zabot`.
- If changes affect `sam_zabot` webapp, also run:

```bash
ssh -i ~/.ssh/tutor_bot_timeweb_ed25519 \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -o ConnectTimeout=60 \
  -o ServerAliveInterval=10 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=accept-new \
  -o ProxyCommand='python3 /tmp/ssh_banner_first_proxy.py %h %p 192.168.0.100' \
  root@5.42.109.83 \
  'systemctl restart tutor-webapp@sam_zabot'
```

If you want the fully explicit deploy sequence:

```bash
SERVER='root@5.42.109.83'
REMOTE_DIR='/tmp/tutor-bots-deploy'
SSH_RSH="ssh -i ~/.ssh/tutor_bot_timeweb_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=60 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=accept-new -o ProxyCommand='python3 /tmp/ssh_banner_first_proxy.py %h %p 192.168.0.100'"

rsync -az --delete \
  --exclude '.git' \
  --exclude '.venv' \
  --exclude '.pytest_cache' \
  --exclude '.ruff_cache' \
  --exclude '.DS_Store' \
  --exclude '.env' \
  --exclude 'bot.log' \
  --exclude '*.sqlite3' \
  -e "$SSH_RSH" \
  ./ "$SERVER:$REMOTE_DIR/"

ssh -i ~/.ssh/tutor_bot_timeweb_ed25519 \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -o ConnectTimeout=60 \
  -o ServerAliveInterval=10 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=accept-new \
  -o ProxyCommand='python3 /tmp/ssh_banner_first_proxy.py %h %p 192.168.0.100' \
  "$SERVER" bash -s <<'EOF'
set -euo pipefail
cd /tmp/tutor-bots-deploy
bash deploy/install_server.sh
systemctl restart tutor-bot@g0_faq_bot tutor-webapp@g0_faq_bot tutor-bot@sam_zabot tutor-webapp@sam_zabot
EOF
```

## Diagnostics

General server check:

```bash
./deploy/check_server.sh root@5.42.109.83
```

Useful manual checks:

```bash
ssh ... root@5.42.109.83 'systemctl --no-pager --full status tutor-bot@g0_faq_bot tutor-webapp@g0_faq_bot tutor-bot@sam_zabot tutor-webapp@sam_zabot nginx'
ssh ... root@5.42.109.83 'journalctl -u tutor-bot@sam_zabot -u tutor-webapp@sam_zabot --no-pager -n 80'
ssh ... root@5.42.109.83 'journalctl -u tutor-bot@g0_faq_bot -u tutor-webapp@g0_faq_bot --no-pager -n 80'
ssh ... root@5.42.109.83 'ss -lntp "( sport = :80 or sport = :443 or sport = :8000 or sport = :8001 )"'
```

Public health checks:

```bash
curl -fsS https://g0faqtutorbot.ru/healthz
curl -fsS https://g0faqtutorbot.ru/client-694590118/healthz
```

## Telegram-Side Checks

To inspect `sam_zabot` menu button from the server:

```bash
python3 - <<'PY'
from pathlib import Path
import json, urllib.request
text = Path('/opt/tutor-bots/sam_zabot/.env').read_text()
token = next(line.split('=', 1)[1].strip() for line in text.splitlines() if line.startswith('BOT_TOKEN='))
with urllib.request.urlopen(f'https://api.telegram.org/bot{token}/getChatMenuButton', timeout=15) as r:
    print(r.read().decode())
PY
```

Student-specific button check:

```bash
python3 - <<'PY'
from pathlib import Path
import json, urllib.parse, urllib.request
token = next(
    line.split('=', 1)[1].strip()
    for line in Path('/opt/tutor-bots/sam_zabot/.env').read_text().splitlines()
    if line.startswith('BOT_TOKEN=')
)
chat_id = 982925733  # replace if needed
params = urllib.parse.urlencode({'chat_id': chat_id})
with urllib.request.urlopen(f'https://api.telegram.org/bot{token}/getChatMenuButton?{params}', timeout=15) as r:
    print(r.read().decode())
PY
```

## Files Worth Opening First

- [deploy/README.md](/Users/fedaersov/Documents/бот/deploy/README.md)
- [deploy/SSH_VPN_RUNBOOK.md](/Users/fedaersov/Documents/бот/deploy/SSH_VPN_RUNBOOK.md)
- [deploy/check_server.sh](/Users/fedaersov/Documents/бот/deploy/check_server.sh)
- [deploy/sync_server.sh](/Users/fedaersov/Documents/бот/deploy/sync_server.sh)
- [src/tutor_bot/main.py](/Users/fedaersov/Documents/бот/src/tutor_bot/main.py)
- [src/tutor_bot/config.py](/Users/fedaersov/Documents/бот/src/tutor_bot/config.py)

## Short Version

If another agent needs the minimum:

1. SSH with the command in this file.
2. Code lives in `/opt/tutor-bots/app`.
3. `g0_faq_bot` webapp is on `:8000`; `sam_zabot` webapp is on `:8001`.
4. Public `sam_zabot` path is `https://g0faqtutorbot.ru/client-694590118`.
5. Restart all four active services after web changes.
6. Do not re-enable legacy `client-694590118` systemd services.
