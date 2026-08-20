"""fetch_fulltext → worker POST /internal/fulltext."""

from __future__ import annotations

import os

import httpx

from config import get_settings
from tools.registry import fail, ok_rows, tracked

FULLTEXT_TIMEOUT_SEC = 25.0


def _worker_url() -> str:
    base = (os.environ.get("WORKER_INTERNAL_URL") or "http://worker:8071").rstrip("/")
    return f"{base}/internal/fulltext"


@tracked("fetch_fulltext")
async def fetch_fulltext(itemId: int) -> dict:
    token = get_settings().service_token_worker
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"itemId": itemId}
    try:
        async with httpx.AsyncClient(timeout=FULLTEXT_TIMEOUT_SEC) as client:
            response = await client.post(_worker_url(), json=payload, headers=headers)
    except httpx.TimeoutException:
        return fail("FETCH_TIMEOUT")
    except httpx.HTTPError:
        return fail("UPSTREAM")
    try:
        body = response.json()
    except ValueError:
        return fail("UPSTREAM")
    if not isinstance(body, dict):
        return fail("UPSTREAM")
    if body.get("ok") is not True:
        reason = body.get("reason") if isinstance(body.get("reason"), str) else "NOT_VISIBLE"
        return fail(reason)
    row = {
        "itemId": body.get("itemId", itemId),
        "content": body.get("content"),
        "truncated": body.get("truncated"),
        "source": body.get("source"),
        "title": body.get("title"),
        "summaryZh": body.get("summaryZh"),
        "scoredAt": body.get("scoredAt"),
        "sourceName": body.get("sourceName"),
    }
    return ok_rows([row])
