# Server deployment

This deploys the bots on a VPS so they keep running when the Mac is off.

## Layout

- `/opt/tutor-bots/app` - shared application code.
- `/opt/tutor-bots/g0_faq_bot/.env` - token and database for `g0_faq_bot`.
- `/opt/tutor-bots/sam_zabot/.env` - token and database for `sam_zabot`.
- `tutor-bot@g0_faq_bot` and `tutor-bot@sam_zabot` - independent bot services.
- `tutor-webapp@g0_faq_bot` - Mini App behind `https://g0faqtutorbot.ru`.

## First install on Ubuntu

Point DNS `A` records for `g0faqtutorbot.ru` and `www.g0faqtutorbot.ru` to the server IP first.

```bash
sudo bash deploy/install_server.sh
sudo nano /opt/tutor-bots/g0_faq_bot/.env
sudo nano /opt/tutor-bots/sam_zabot/.env
```

Fill real `BOT_TOKEN` values. Keep separate `DATABASE_PATH` values exactly as in the examples.

Start the bots and the Mini App:

```bash
sudo systemctl enable --now tutor-bot@g0_faq_bot
sudo systemctl enable --now tutor-bot@sam_zabot
sudo systemctl enable --now tutor-webapp@g0_faq_bot
```

For later code updates from this machine:

```bash
./deploy/sync_server.sh root@5.42.109.83
```

Issue HTTPS certificate:

```bash
sudo certbot certonly --webroot -w /var/www/certbot \
  -d g0faqtutorbot.ru -d www.g0faqtutorbot.ru
sudo cp /opt/tutor-bots/app/deploy/nginx/g0faqtutorbot.ru.ssl.conf \
  /etc/nginx/sites-available/g0faqtutorbot.ru.conf
sudo nginx -t
sudo systemctl reload nginx
```

Certbot installs a renewal timer on Ubuntu packages. Check it:

```bash
systemctl list-timers | grep certbot
```

## Operations

```bash
sudo systemctl status tutor-bot@g0_faq_bot
sudo systemctl status tutor-bot@sam_zabot
sudo journalctl -u tutor-bot@g0_faq_bot -f
sudo journalctl -u tutor-bot@sam_zabot -f
sudo systemctl restart tutor-bot@g0_faq_bot
```

Telegram Mini App should use `WEBAPP_URL=https://g0faqtutorbot.ru` in `/opt/tutor-bots/g0_faq_bot/.env`.
If BotFather asks for a web app domain, set `g0faqtutorbot.ru`.

## Diagnostics

Run this from the local project to check the VPS without printing bot tokens:

```bash
./deploy/check_server.sh root@5.42.109.83
```

The output should show active `tutor-bot@g0_faq_bot`, `tutor-bot@sam_zabot`,
`tutor-webapp@g0_faq_bot`, active `nginx`, a successful local `/healthz`, and
Telegram `getMe` results for both tokens.

Local Telegram polling is blocked by default. Use `ALLOW_LOCAL_BOT_POLLING=1`
only for a short manual test, then stop the local process before enabling the
server services again.
