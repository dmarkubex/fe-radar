"""Session ledger after HMAC (design L555–561)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class CopilotError(Exception):
    def __init__(self, status_code: int, code: str) -> None:
        self.status_code = status_code
        self.code = code


class FeedbackBody(BaseModel):
    rating: Literal[-1, 1]
    reason: str | None = Field(default=None, max_length=2000)


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _as_dict(cursor: Any, row: Any) -> dict:
    if isinstance(row, dict):
        return row
    mapping = getattr(row, "_mapping", None)
    if mapping is not None:
        return dict(mapping)
    names = [col.name for col in (cursor.description or [])]
    return dict(zip(names, row, strict=False))


async def list_sessions(conn: Any, uid: int) -> list[dict]:
    sql = (
        "SELECT id, title, source, item_id, last_active, created_at "
        "FROM copilot.sessions "
        "WHERE user_id=%(uid)s "
        "ORDER BY last_active DESC "
        "LIMIT 50"
    )
    params = {"uid": uid}
    cursor = await conn.execute(sql, params)
    rows = await cursor.fetchall()
    sessions: list[dict] = []
    for row in rows:
        data = _as_dict(cursor, row)
        sessions.append(
            {
                "id": data.get("id"),
                "title": data.get("title"),
                "source": data.get("source"),
                "itemId": data.get("item_id"),
                "lastActive": _iso(data.get("last_active")),
                "createdAt": _iso(data.get("created_at")),
            }
        )
    return sessions


async def assert_session_owner(conn: Any, session_id: int, uid: int) -> dict:
    sql = (
        "SELECT id, title, source, item_id, last_active, created_at "
        "FROM copilot.sessions "
        "WHERE id=%(id)s AND user_id=%(uid)s"
    )
    params = {"id": session_id, "uid": uid}
    cursor = await conn.execute(sql, params)
    row = await cursor.fetchone()
    if row is None:
        raise CopilotError(403, "COPILOT_NOT_OWNER")
    return _as_dict(cursor, row)


async def list_messages(conn: Any, session_id: int, uid: int) -> list[dict]:
    await assert_session_owner(conn, session_id, uid)
    sql = (
        "SELECT * FROM ("
        "  SELECT id, role, content, citations, created_at "
        "  FROM copilot.messages "
        "  WHERE session_id=%(sid)s "
        "  ORDER BY id DESC "
        "  LIMIT 500"
        ") t ORDER BY id ASC"
    )
    params = {"sid": session_id}
    cursor = await conn.execute(sql, params)
    rows = await cursor.fetchall()
    messages: list[dict] = []
    for row in rows:
        data = _as_dict(cursor, row)
        citations = data.get("citations")
        if citations is None:
            citations = []
        messages.append(
            {
                "id": data.get("id"),
                "role": data.get("role"),
                "content": data.get("content"),
                "citations": citations,
                "createdAt": _iso(data.get("created_at")),
            }
        )
    return messages


async def upsert_feedback(
    conn: Any,
    message_id: int,
    uid: int,
    rating: int,
    reason: str | None,
) -> dict:
    lookup_sql = (
        "SELECT m.id, m.role, s.user_id "
        "FROM copilot.messages m "
        "JOIN copilot.sessions s ON s.id = m.session_id "
        "WHERE m.id=%(mid)s AND s.user_id=%(uid)s"
    )
    lookup_params = {"mid": message_id, "uid": uid}
    cursor = await conn.execute(lookup_sql, lookup_params)
    row = await cursor.fetchone()
    if row is None:
        raise CopilotError(403, "COPILOT_NOT_OWNER")
    data = _as_dict(cursor, row)
    if data.get("role") != "assistant":
        raise CopilotError(400, "COPILOT_FEEDBACK_NOT_ASSISTANT")
    upsert_sql = (
        "INSERT INTO copilot.feedbacks (message_id, user_id, rating, reason) "
        "VALUES (%(mid)s, %(uid)s, %(rating)s, %(reason)s) "
        "ON CONFLICT (message_id, user_id) DO UPDATE "
        "SET rating=EXCLUDED.rating, reason=EXCLUDED.reason, created_at=now()"
    )
    upsert_params = {"mid": message_id, "uid": uid, "rating": rating, "reason": reason}
    await conn.execute(upsert_sql, upsert_params)
    return {"ok": True, "messageId": message_id, "rating": rating}
