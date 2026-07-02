from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any


def utc_now() -> datetime:
    return datetime.now(UTC)


def random_token(bytes_count: int = 24) -> str:
    return secrets.token_urlsafe(bytes_count)


def make_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 210_000)
    return f"pbkdf2_sha256$210000${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations, salt, digest = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        expected = hashlib.pbkdf2_hmac("sha256", password.encode(), _unb64(salt), int(iterations))
        return hmac.compare_digest(_b64(expected), digest)
    except (ValueError, TypeError):
        return False


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def create_access_token(payload: dict[str, Any], secret: str, ttl_minutes: int) -> str:
    body = dict(payload)
    body["exp"] = int((utc_now() + timedelta(minutes=ttl_minutes)).timestamp())
    header = {"alg": "HS256", "typ": "JWT"}
    head = _b64(json.dumps(header, separators=(",", ":")).encode())
    claims = _b64(json.dumps(body, separators=(",", ":")).encode())
    sig = hmac.new(secret.encode(), f"{head}.{claims}".encode(), hashlib.sha256).digest()
    return f"{head}.{claims}.{_b64(sig)}"


def verify_access_token(token: str, secret: str) -> dict[str, Any] | None:
    parts = token.split(".")
    if len(parts) != 3:
        return None
    expected = hmac.new(secret.encode(), f"{parts[0]}.{parts[1]}".encode(), hashlib.sha256).digest()
    try:
        signature = _unb64(parts[2])
        payload = json.loads(_unb64(parts[1]))
    except (ValueError, json.JSONDecodeError):
        return None
    if not hmac.compare_digest(signature, expected):
        return None
    if int(payload.get("exp", 0)) < int(utc_now().timestamp()):
        return None
    return payload
