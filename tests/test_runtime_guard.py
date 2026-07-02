from __future__ import annotations

import pytest

from tutor_bot.main import assert_polling_allowed


def clear_runtime_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("ALLOW_LOCAL_BOT_POLLING", "BOT_RUNTIME", "ENV_FILE", "INVOCATION_ID"):
        monkeypatch.delenv(name, raising=False)


def test_polling_guard_blocks_unmarked_local_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    clear_runtime_env(monkeypatch)

    with pytest.raises(SystemExit):
        assert_polling_allowed()


def test_polling_guard_allows_server_env_file(monkeypatch: pytest.MonkeyPatch) -> None:
    clear_runtime_env(monkeypatch)
    monkeypatch.setenv("ENV_FILE", "/opt/tutor-bots/g0_faq_bot/.env")

    assert_polling_allowed()


def test_polling_guard_allows_explicit_local_override(monkeypatch: pytest.MonkeyPatch) -> None:
    clear_runtime_env(monkeypatch)
    monkeypatch.setenv("ALLOW_LOCAL_BOT_POLLING", "1")

    assert_polling_allowed()
