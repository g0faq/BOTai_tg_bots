#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-crmtutor.ru}"
EMAIL="${LETSENCRYPT_EMAIL:-admin@crmtutor.ru}"

docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN" \
  -d "www.$DOMAIN"

docker compose restart nginx
