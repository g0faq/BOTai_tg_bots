#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash deploy/install_server.sh" >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_DIR="/opt/tutor-bots"
APP_DIR="$BASE_DIR/app"
BOT_USER="tutorbot"

apt-get update
apt-get install -y ca-certificates curl dnsutils python3 python3-venv python3-pip nginx certbot rsync

if ! id "$BOT_USER" >/dev/null 2>&1; then
  useradd --system --home "$BASE_DIR" --shell /usr/sbin/nologin "$BOT_USER"
fi

mkdir -p "$APP_DIR" "$BASE_DIR/g0_faq_bot" "$BASE_DIR/sam_zabot" /var/www/certbot

if [ "$SOURCE_DIR" != "$APP_DIR" ]; then
  rsync -a --delete \
    --exclude ".git" \
    --exclude ".venv" \
    --exclude "bot.log" \
    --exclude "*.sqlite3" \
    "$SOURCE_DIR"/ "$APP_DIR"/
fi

python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/python" -m pip install --upgrade pip
"$APP_DIR/.venv/bin/python" -m pip install -e "$APP_DIR"

for name in g0_faq_bot sam_zabot; do
  if [ ! -f "$BASE_DIR/$name/.env" ]; then
    cp "$APP_DIR/deploy/env/$name.env.example" "$BASE_DIR/$name/.env"
    chmod 600 "$BASE_DIR/$name/.env"
  fi
done

cp "$APP_DIR"/deploy/systemd/*.service /etc/systemd/system/
cp "$APP_DIR/deploy/nginx/g0faqtutorbot.ru.http.conf" /etc/nginx/sites-available/g0faqtutorbot.ru.conf
ln -sfn /etc/nginx/sites-available/g0faqtutorbot.ru.conf /etc/nginx/sites-enabled/g0faqtutorbot.ru.conf
rm -f /etc/nginx/sites-enabled/default

chown -R "$BOT_USER:$BOT_USER" "$BASE_DIR"
systemctl daemon-reload
nginx -t
systemctl enable --now nginx

echo "Installed. Edit /opt/tutor-bots/g0_faq_bot/.env and /opt/tutor-bots/sam_zabot/.env, then enable services."
