from __future__ import annotations

import base64
import json
import os
import time

from auth import build_canonical, compute_signature


def _headers(
    method: str,
    path: str,
    body: bytes,
    user_id: int,
    role: str,
    secret: str,
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


def test_hmac_valid_headers_pass(client, internal_secret: str) -> None:
    headers = _headers("GET", "/sessions", b"", 7, "viewer", internal_secret)
    response = client.get("/sessions", headers=headers)
    assert response.status_code == 200
    assert response.json() == {"sessions": []}


def test_hmac_missing_role_401(client, internal_secret: str) -> None:
    headers = _headers("GET", "/sessions", b"", 7, "viewer", internal_secret)
    headers["x-fer-user"] = base64.b64encode(json.dumps({"userId": 7}).encode("utf-8")).decode(
        "ascii"
    )
    assert client.get("/sessions", headers=headers).status_code == 401


def test_hmac_wrong_signature_401(client, internal_secret: str) -> None:
    headers = _headers("GET", "/sessions", b"", 7, "viewer", internal_secret)
    headers["x-fer-internal-auth"] = "0" * 64
    assert client.get("/sessions", headers=headers).status_code == 401


def test_hmac_expired_ts_401(client, internal_secret: str) -> None:
    ts = str(int(time.time()) - 31)
    headers = _headers("GET", "/sessions", b"", 7, "viewer", internal_secret, ts=ts)
    assert client.get("/sessions", headers=headers).status_code == 401


def test_hmac_replay_nonce_401(client, internal_secret: str) -> None:
    nonce = os.urandom(16).hex()
    headers = _headers("GET", "/sessions", b"", 7, "viewer", internal_secret, nonce=nonce)
    assert client.get("/sessions", headers=headers).status_code == 200
    assert client.get("/sessions", headers=headers).status_code == 401


def test_hmac_canonical_includes_role(client, internal_secret: str) -> None:
    headers = _headers("GET", "/sessions", b"", 7, "viewer", internal_secret)
    headers["x-fer-user"] = base64.b64encode(
        json.dumps({"userId": 7, "role": "admin"}, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    assert client.get("/sessions", headers=headers).status_code == 401


def test_hmac_missing_headers_401(client) -> None:
    assert client.get("/sessions").status_code == 401
