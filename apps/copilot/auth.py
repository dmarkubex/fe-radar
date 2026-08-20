"""HMAC-SHA256 overlay auth. Canonical formula lives only here."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import threading
import time
from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException, Request

from config import get_settings

logger = logging.getLogger(__name__)

ALLOWED_ROLES = frozenset({"viewer", "editor", "admin"})
Role = Literal["viewer", "editor", "admin"]
NONCE_TTL_SECONDS = 30
NONCE_MAX_SIZE = 4096
TS_SKEW_SECONDS = 30
NONCE_HEX_LEN = 32


@dataclass(frozen=True)
class HmacUser:
    user_id: int
    role: Role


class NonceCache:
    def __init__(self, ttl_seconds: float = NONCE_TTL_SECONDS, max_size: int = NONCE_MAX_SIZE) -> None:
        self._ttl = ttl_seconds
        self._max = max_size
        self._store: dict[str, float] = {}
        self._lock = threading.Lock()

    def _purge(self, now: float) -> None:
        expired = [key for key, seen_at in self._store.items() if now - seen_at > self._ttl]
        for key in expired:
            del self._store[key]

    def accept(self, nonce: str, now: float) -> bool:
        with self._lock:
            self._purge(now)
            if nonce in self._store:
                return False
            if len(self._store) >= self._max:
                self._purge(now)
                if len(self._store) >= self._max:
                    logger.warning("nonce cache full")
                    return False
            self._store[nonce] = now
            return True


nonce_cache = NonceCache()


def build_canonical(
    method: str,
    path: str,
    ts: str,
    nonce: str,
    body: bytes | str,
    user_id: int,
    role: str,
) -> str:
    body_bytes = body.encode("utf-8") if isinstance(body, str) else body
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    return f"{method}|{path}|{ts}|{nonce}|{body_hash}|{user_id}|{role}"


def compute_signature(canonical: str, secret: str) -> str:
    key = "".join(secret.split()).encode("utf-8")
    return hmac.new(key, canonical.encode("utf-8"), hashlib.sha256).hexdigest()


def _unauthorized() -> HTTPException:
    return HTTPException(status_code=401, detail="unauthorized")


def _parse_user_header(raw: str) -> tuple[int, Role]:
    try:
        decoded = base64.b64decode(raw, validate=False)
        payload = json.loads(decoded)
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        raise _unauthorized() from None
    if not isinstance(payload, dict) or "role" not in payload:
        raise _unauthorized()
    role = payload["role"]
    if role not in ALLOWED_ROLES:
        raise _unauthorized()
    user_id = payload.get("userId")
    if type(user_id) is not int:
        raise _unauthorized()
    return user_id, role


async def require_hmac(request: Request) -> HmacUser:
    ts_raw = request.headers.get("x-fer-ts")
    nonce = request.headers.get("x-fer-nonce")
    user_raw = request.headers.get("x-fer-user")
    signature = request.headers.get("x-fer-internal-auth")
    if not ts_raw or not nonce or not user_raw or not signature:
        raise _unauthorized()

    try:
        ts = int(ts_raw)
    except ValueError:
        raise _unauthorized() from None

    now = time.time()
    if abs(now - ts) > TS_SKEW_SECONDS:
        raise _unauthorized()

    if len(nonce) != NONCE_HEX_LEN:
        raise _unauthorized()
    try:
        bytes.fromhex(nonce)
    except ValueError:
        raise _unauthorized() from None

    user_id, role = _parse_user_header(user_raw)
    body = await request.body()
    canonical = build_canonical(
        request.method,
        request.url.path,
        ts_raw,
        nonce,
        body,
        user_id,
        role,
    )
    expected = compute_signature(canonical, get_settings().copilot_internal_secret)
    if len(signature) != len(expected) or not hmac.compare_digest(expected, signature):
        raise _unauthorized()

    if not nonce_cache.accept(nonce, now):
        raise _unauthorized()

    return HmacUser(user_id=user_id, role=role)
