from __future__ import annotations

import os
from dataclasses import replace

from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from tutor_bot.config import load_settings
from tutor_bot.webapp import app as g0_app
from tutor_bot.webapp import create_app


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


base_url = _required_env("PUBLIC_BASE_URL").rstrip("/")
telegram_base_url = os.getenv("TELEGRAM_WEBAPP_BASE_URL", "https://botai-g0faq.amvera.io").rstrip("/")
base_settings = load_settings()
sam_settings = replace(
    base_settings,
    bot_token=_required_env("SAM_BOT_TOKEN"),
    database_path="/data/sam_zabot.sqlite3",
    webapp_url=f"{telegram_base_url}/client-694590118/",
    webapp_url_aliases=[],
)

app = FastAPI(title="BOTai Telegram bots")


@app.get("/client-694590118", include_in_schema=False)
def redirect_sam_miniapp() -> RedirectResponse:
    return RedirectResponse(url="/client-694590118/", status_code=307)


app.mount("/client-694590118", create_app(sam_settings))
app.mount("/", g0_app)
