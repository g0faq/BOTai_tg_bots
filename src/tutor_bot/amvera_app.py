from __future__ import annotations

import os
import hmac
from dataclasses import replace
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request

from tutor_bot.config import load_settings
from tutor_bot.webapp import app as g0_app
from tutor_bot.webapp import create_app


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


base_url = _required_env("PUBLIC_BASE_URL").rstrip("/")
base_settings = load_settings()
sam_settings = replace(
    base_settings,
    bot_token=_required_env("SAM_BOT_TOKEN"),
    database_path=os.getenv("SAM_DATABASE_PATH", "/data/sam_zabot.sqlite3"),
    webapp_url=f"{base_url}/client-694590118",
    webapp_url_aliases=[],
)

app = FastAPI(title="BOTai Telegram bots")


@app.put("/__admin/migrate/text/{target_name}")
async def import_runtime_secret(
    target_name: str,
    request: Request,
    x_migration_token: str | None = Header(default=None),
) -> dict[str, str | int]:
    expected_tokens = [
        token
        for token in (
            os.getenv("MIGRATION_TOKEN", ""),
            os.getenv("SAM_BOT_TOKEN", ""),
            os.getenv("G0_BOT_TOKEN", ""),
        )
        if token
    ]
    if not expected_tokens:
        raise HTTPException(status_code=404, detail="Migration endpoint is disabled")
    if not x_migration_token or not any(hmac.compare_digest(x_migration_token, token) for token in expected_tokens):
        raise HTTPException(status_code=403, detail="Invalid migration token")
    if target_name != "g0_bot_token":
        raise HTTPException(status_code=404, detail="Unknown migration target")

    body = (await request.body()).strip()
    if not body:
        raise HTTPException(status_code=400, detail="Empty secret upload")
    if len(body) > 1024:
        raise HTTPException(status_code=413, detail="Secret upload is too large")

    target = Path("/data/g0_bot_token")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body + b"\n")
    target.chmod(0o600)
    return {"status": "ok", "target": target_name, "bytes": len(body)}


app.mount("/client-694590118", create_app(sam_settings))
app.mount("/", g0_app)
