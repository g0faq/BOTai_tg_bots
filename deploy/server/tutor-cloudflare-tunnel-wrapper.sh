#!/usr/bin/env bash
set -euo pipefail

/usr/local/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8088 2>&1 | while IFS= read -r line; do
  printf "%s\n" "$line"
  if [[ "$line" =~ https://[A-Za-z0-9-]+\.trycloudflare\.com ]]; then
    url="${BASH_REMATCH[0]}"
    if [[ "$url" == "https://api.trycloudflare.com" ]]; then
      continue
    fi
    current="$(cat /run/tutor-cloudflare-url 2>/dev/null || true)"
    if [[ "$current" != "$url" ]]; then
      /usr/local/sbin/tutor-update-webapp-aliases.sh "$url" || true
    fi
  fi
done
