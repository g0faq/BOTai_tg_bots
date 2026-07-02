from __future__ import annotations

import os
import hmac
import sqlite3
import time
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


def _migration_targets() -> dict[str, Path]:
    return {
        "g0_faq_bot": Path(os.getenv("G0_DATABASE_PATH", "/data/g0_faq_bot.sqlite3")),
        "sam_zabot": Path(os.getenv("SAM_DATABASE_PATH", "/data/sam_zabot.sqlite3")),
    }


def _check_sqlite_integrity(path: Path) -> None:
    try:
        with sqlite3.connect(path) as conn:
            result = conn.execute("PRAGMA integrity_check").fetchone()
    except sqlite3.Error as exc:
        raise HTTPException(status_code=400, detail=f"Invalid SQLite database: {exc}") from exc
    if not result or result[0] != "ok":
        raise HTTPException(status_code=400, detail=f"SQLite integrity_check failed: {result!r}")


@app.put("/__admin/migrate/sqlite/{target_name}")
async def import_sqlite_database(
    target_name: str,
    request: Request,
    x_migration_token: str | None = Header(default=None),
) -> dict[str, str | int]:
    expected_token = os.getenv("MIGRATION_TOKEN", "")
    if not expected_token:
        raise HTTPException(status_code=404, detail="Migration endpoint is disabled")
    if not x_migration_token or not os.path.exists("/data") or not os.access("/data", os.W_OK):
        raise HTTPException(status_code=403, detail="Migration is not allowed")
    if not hmac.compare_digest(x_migration_token, expected_token):
        raise HTTPException(status_code=403, detail="Invalid migration token")

    targets = _migration_targets()
    if target_name not in targets:
        raise HTTPException(status_code=404, detail="Unknown migration target")

    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty database upload")
    if len(body) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Database upload is too large")

    target = targets[target_name]
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f".{target.name}.upload-{int(time.time())}")
    tmp.write_bytes(body)
    try:
        _check_sqlite_integrity(tmp)
        if target.exists():
            backup = target.with_name(f"{target.name}.pre-migration-{int(time.time())}")
            target.replace(backup)
        tmp.replace(target)
    finally:
        if tmp.exists():
            tmp.unlink()

    return {"status": "ok", "target": target_name, "bytes": len(body)}


app.mount("/client-694590118", create_app(sam_settings))
app.mount("/", g0_app)
