from __future__ import annotations

import base64
import json
import os
import time
from typing import Any

from auth import build_canonical, compute_signature

INTERNAL_SECRET = "test-internal-secret"
WORKER_TOKEN = "test-worker-token"


class Col:
    def __init__(self, name: str) -> None:
        self.name = name


class FakeCursor:
    def __init__(self, rows: list, colnames: list[str]) -> None:
        self._rows = rows
        self.description = [Col(name) for name in colnames]

    async def fetchall(self) -> list:
        return self._rows

    async def fetchone(self) -> Any:
        return self._rows[0] if self._rows else None


class FakeConn:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict | None]] = []
        self._queue: list[tuple[list | None, BaseException | None, list[str]]] = []

    def enqueue(
        self,
        rows: list | None = None,
        exc: BaseException | None = None,
        colnames: list[str] | None = None,
    ) -> None:
        self._queue.append((rows, exc, colnames or []))

    async def execute(self, sql: str, params: dict | None = None) -> FakeCursor:
        self.calls.append((sql, params))
        stripped = sql.strip().upper()
        if stripped.startswith(("SAVEPOINT", "ROLLBACK", "RELEASE")):
            return FakeCursor([], [])
        if not self._queue:
            return FakeCursor([], [])
        rows, exc, colnames = self._queue.pop(0)
        if exc is not None:
            raise exc
        return FakeCursor(rows or [], colnames)


class FakePool:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn

    def connection(self) -> "_ConnCM":
        return _ConnCM(self.conn)

    async def close(self) -> None:
        return None


class _ConnCM:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn

    async def __aenter__(self) -> FakeConn:
        return self.conn

    async def __aexit__(self, *_exc: object) -> None:
        return None


def hmac_headers(
    method: str,
    path: str,
    body: bytes,
    user_id: int,
    role: str,
    secret: str = INTERNAL_SECRET,
    *,
    ts: str | None = None,
    nonce: str | None = None,
) -> dict[str, str]:
    ts = str(int(time.time())) if ts is None else ts
    nonce = os.urandom(16).hex() if nonce is None else nonce
    canonical = build_canonical(method, path, ts, nonce, body, user_id, role)
    signature = compute_signature(canonical, secret)
    user = base64.b64encode(
        json.dumps({"userId": user_id, "role": role}, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    return {
        "x-fer-ts": ts,
        "x-fer-nonce": nonce,
        "x-fer-user": user,
        "x-fer-internal-auth": signature,
    }
