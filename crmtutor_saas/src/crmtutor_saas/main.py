from __future__ import annotations

import uvicorn

from crmtutor_saas.config import load_settings


def main() -> None:
    settings = load_settings()
    uvicorn.run("crmtutor_saas.app:app", host=settings.app_host, port=settings.app_port, reload=False)


if __name__ == "__main__":
    main()
