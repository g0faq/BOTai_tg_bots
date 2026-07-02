from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from crmtutor_saas.app import create_app
from crmtutor_saas.config import Settings


def settings(tmp_path: Path) -> Settings:
    return Settings(
        public_base_url="http://testserver",
        database_path=str(tmp_path / "crm.sqlite3"),
        legacy_database_path=str(Path(__file__).resolve().parents[2] / "bot.sqlite3"),
        jwt_secret="test-secret",
        default_workspace_slug="fedor",
        default_tutor_first_name="Федор",
        default_tutor_email="owner@crmtutor.ru",
    )


def test_public_profile_imports_legacy_workspace(tmp_path: Path) -> None:
    with TestClient(create_app(settings(tmp_path))) as client:
        response = client.get("/api/public/tutors/fedor")

    assert response.status_code == 200
    assert response.json()["profile"]["workspace_id"] == 1


def test_sensitive_single_segment_paths_do_not_return_spa(tmp_path: Path) -> None:
    with TestClient(create_app(settings(tmp_path))) as client:
        response = client.get("/.env")
        config = client.get("/config.json")

    assert response.status_code == 404
    assert config.status_code == 404


def test_tutor_can_self_register_workspace(tmp_path: Path) -> None:
    with TestClient(create_app(settings(tmp_path))) as client:
        response = client.post(
            "/api/tutors/register",
            json={
                "email": "new@crmtutor.ru",
                "password": "strongpass",
                "first_name": "Анна",
                "last_name": "Иванова",
                "username": "anna",
                "subjects": ["Физика"],
                "directions": ["ЕГЭ", "Олимпиады"],
                "hourly_price": 3000,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["workspace"]["public_slug"] == "anna"
    assert payload["public_url"] == "http://testserver/anna"


def test_sms_is_not_auth_channel(tmp_path: Path) -> None:
    with TestClient(create_app(settings(tmp_path))) as client:
        health = client.get("/api/health")
        config = client.get("/api/config")
        missing = client.post("/api/auth/sms/request", json={"phone": "+79990000000"})

    assert health.json()["sms"] == "disabled"
    assert config.json()["sms"] == "disabled"
    assert config.json()["telegram_bot_username"] == "crmtutor_bot"
    assert missing.status_code == 404


def test_telegram_login_issues_tokens(tmp_path: Path) -> None:
    with TestClient(create_app(settings(tmp_path))) as client:
        response = client.post(
            "/api/auth/telegram",
            json={"telegram_id": 123456, "username": "student_tg", "first_name": "Student"},
        )

    assert response.status_code == 200
    assert response.json()["access_token"]
    assert response.json()["user"]["telegram_id"] == 123456


def test_email_login_with_password(tmp_path: Path) -> None:
    with TestClient(create_app(settings(tmp_path))) as client:
        registered = client.post(
            "/api/tutors/register",
            json={
                "email": "fast@crmtutor.ru",
                "password": "strongpass",
                "first_name": "Fast",
                "username": "fast",
            },
        )
        response = client.post("/api/auth/email/login", json={"email": "fast@crmtutor.ru", "password": "strongpass"})
        bad = client.post("/api/auth/email/login", json={"email": "fast@crmtutor.ru", "password": "badpass"})

    assert registered.status_code == 200
    assert response.status_code == 200
    assert response.json()["access_token"]
    assert response.json()["user"]["email"] == "fast@crmtutor.ru"
    assert bad.status_code == 401


def test_public_student_can_join_tutor_without_existing_auth(tmp_path: Path) -> None:
    with TestClient(create_app(settings(tmp_path))) as client:
        response = client.post(
            "/api/public/register",
            json={
                "email": "student@crmtutor.ru",
                "password": "strongpass",
                "role": "student",
                "tutor_username": "fedor",
                "full_name": "Петр Ученик",
                "grade": "10",
                "timezone": "Europe/Moscow",
                "prep_type": "ЕГЭ",
                "subject": "Информатика",
            },
        )

    assert response.status_code == 200
    assert response.json()["auth"]["access_token"]
    assert response.json()["student"]["name"] == "Петр Ученик"


def test_email_otp_login_and_workspace_isolation(tmp_path: Path) -> None:
    with TestClient(create_app(settings(tmp_path))) as client:
        requested = client.post("/api/auth/email/request", json={"email": "owner@crmtutor.ru"})
        code = requested.json()["dev_code"]
        verified = client.post("/api/auth/email/verify", json={"email": "owner@crmtutor.ru", "code": code})
        token = verified.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        own = client.get("/api/workspaces/1/students", headers=headers)
        isolated = client.get("/api/workspaces/999/students", headers=headers)

    assert own.status_code == 200
    assert isolated.status_code == 403
