# SSH through local VPN

Use this note when direct SSH to the Timeweb server hangs, times out, or closes
while the user's Mac VPN is enabled.

## Server

- Host: `5.42.109.83`
- User: `root`
- Working key: `~/.ssh/tutor_bot_timeweb_ed25519`
- Known working local source IP: `192.168.0.101`

Do not rely on password auth from Codex when VPN routing is odd. Prefer the SSH
key and the banner-first proxy below.

## Why direct SSH fails

With the user's VPN enabled, direct TCP connections from Codex/macOS can route
through the VPN and stall. SSH may hang before the banner, close during `rsync`,
or fail even though the server is healthy from the Timeweb console.

The workaround is to force the outbound socket to bind to the local LAN source
address before connecting to the server.

## ProxyCommand

The helper script previously used:

```bash
/tmp/ssh_banner_first_proxy.py
```

If it is missing, recreate it:

```python
#!/usr/bin/env python3
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
source_ip = sys.argv[3]

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(60)
sock.bind((source_ip, 0))
sock.connect((host, port))

stdin = sys.stdin.buffer
stdout = sys.stdout.buffer

while True:
    import select

    readable, _, _ = select.select([sock, stdin], [], [])
    if sock in readable:
        data = sock.recv(65536)
        if not data:
            break
        stdout.write(data)
        stdout.flush()
    if stdin in readable:
        data = stdin.read1(65536)
        if not data:
            sock.shutdown(socket.SHUT_WR)
        else:
            sock.sendall(data)
```

Make it executable:

```bash
chmod +x /tmp/ssh_banner_first_proxy.py
```

## SSH command

Use this exact shape:

```bash
ssh -i ~/.ssh/tutor_bot_timeweb_ed25519 \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -o ConnectTimeout=60 \
  -o ServerAliveInterval=10 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=accept-new \
  -o ProxyCommand='python3 /tmp/ssh_banner_first_proxy.py %h %p 192.168.0.101' \
  root@5.42.109.83 'hostname && systemctl is-active nginx'
```

For `scp` / `rsync`, pass the same SSH options:

```bash
scp -i ~/.ssh/tutor_bot_timeweb_ed25519 \
  -o IdentitiesOnly=yes \
  -o BatchMode=yes \
  -o ConnectTimeout=60 \
  -o ServerAliveInterval=10 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=accept-new \
  -o ProxyCommand='python3 /tmp/ssh_banner_first_proxy.py %h %p 192.168.0.101' \
  local-file root@5.42.109.83:/tmp/
```

```bash
RSYNC_RSH="ssh -i ~/.ssh/tutor_bot_timeweb_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=60 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=accept-new -o ProxyCommand='python3 /tmp/ssh_banner_first_proxy.py %h %p 192.168.0.101'"
rsync -az local-dir/ root@5.42.109.83:/remote-dir/
```

## If transfers still drop

Upload one small tarball instead of many small files:

```bash
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -czf /tmp/tutor-bot-deploy.tgz src tests deploy pyproject.toml run_bot.sh run_webapp.sh README.md
```

Then upload/extract with the SSH command above.

After extraction on Linux, remove accidental AppleDouble files if any appear:

```bash
find /opt/tutor-bot /opt/tutor-bot-client-694590118 -name '._*' -type f -delete
```

## Server verification

```bash
systemctl is-active tutor-bot.service tutor-webapp.service tutor-bot-client-694590118.service tutor-webapp-client-694590118.service nginx
curl -fsS https://g0faqtutorbot.ru/healthz
curl -fsS https://g0faqtutorbot.ru/client-694590118/healthz
curl -fsS https://g0faqtutorbot.ru:8443/healthz
curl -fsS https://g0faqtutorbot.ru:8443/client-694590118/healthz
```

## Notes

- Do not disable the user's VPN.
- Do not flush server firewall rules unless the user explicitly asks and the
  console is available.
- Keep `BOT_RUNTIME=server` in systemd units so local Mac polling cannot steal
  Telegram updates.
- If direct browser checks from Codex fail, also check from the server itself;
  local VPN routing can make Codex-side checks misleading.
