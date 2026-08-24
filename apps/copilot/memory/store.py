"""Session ledger after HMAC (design L555–561)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb


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


async def item_is_visible(conn: Any, item_id: int) -> bool:
    sql = "SELECT v.id FROM copilot.visible_items v WHERE v.id = %(iid)s"
    cursor = await conn.execute(sql, {"iid": item_id})
    return await cursor.fetchone() is not None


async def visible_ids_of(conn: Any, ids: list[int]) -> set[int]:
    if not ids:
        return set()
    sql = "SELECT v.id FROM copilot.visible_items v WHERE v.id = ANY(%(ids)s)"
    cursor = await conn.execute(sql, {"ids": ids})
    found: set[int] = set()
    for row in await cursor.fetchall():
        data = _as_dict(cursor, row)
        value = data.get("id")
        if isinstance(value, int):
            found.add(value)
    return found


async def create_session(conn: Any, uid: int, source: str, item_id: int | None, title: str | None) -> dict:
    sql = (
        "INSERT INTO copilot.sessions (user_id, source, item_id, title, last_active) "
        "VALUES (%(uid)s, %(source)s, %(item_id)s, %(title)s, now()) "
        "RETURNING id, source, item_id"
    )
    cursor = await conn.execute(
        sql, {"uid": uid, "source": source, "item_id": item_id, "title": title}
    )
    row = await cursor.fetchone()
    if row is None:
        raise CopilotError(500, "COPILOT_INTERNAL")
    return _as_dict(cursor, row)


async def acquire_turn_lock(conn: Any, session_id: int, ts: datetime) -> dict | None:
    sql = (
        "UPDATE copilot.sessions SET turn_locked_at=%(ts)s "
        "WHERE id=%(id)s AND (turn_locked_at IS NULL OR turn_locked_at < now() - interval '15 minutes') "
        "RETURNING id, turn_locked_at"
    )
    cursor = await conn.execute(sql, {"ts": ts, "id": session_id})
    row = await cursor.fetchone()
    return _as_dict(cursor, row) if row is not None else None


async def release_turn_lock(conn: Any, session_id: int, ts: datetime) -> None:
    sql = (
        "UPDATE copilot.sessions SET turn_locked_at=NULL "
        "WHERE id=%(id)s AND turn_locked_at=%(ts)s"
    )
    await conn.execute(sql, {"id": session_id, "ts": ts})


async def insert_user_message(conn: Any, session_id: int, content: str) -> int:
    sql = (
        "INSERT INTO copilot.messages (session_id, role, content) "
        "VALUES (%(sid)s, %(role)s, %(content)s) RETURNING id"
    )
    cursor = await conn.execute(sql, {"sid": session_id, "role": "user", "content": content})
    row = await cursor.fetchone()
    if row is None:
        raise CopilotError(500, "COPILOT_INTERNAL")
    return _as_dict(cursor, row)["id"]


async def load_history_before(conn: Any, session_id: int, current_id: int) -> list[dict]:
    sql = (
        "SELECT role, content FROM copilot.messages "
        "WHERE session_id=%(sid)s AND id < %(current_id)s "
        "AND role IN ('user', 'assistant') "
        "ORDER BY id DESC LIMIT 12"
    )
    cursor = await conn.execute(sql, {"sid": session_id, "current_id": current_id})
    rows = []
    for row in await cursor.fetchall():
        rows.append(_as_dict(cursor, row))
    return rows


async def insert_assistant_message(
    conn: Any, session_id: int, content: str, citations: list
) -> int:
    sql = (
        "INSERT INTO copilot.messages (session_id, role, content, citations) "
        "VALUES (%(sid)s, %(role)s, %(content)s, %(citations)s) RETURNING id"
    )
    cursor = await conn.execute(
        sql,
        {
            "sid": session_id,
            "role": "assistant",
            "content": content,
            "citations": Jsonb(citations),
        },
    )
    row = await cursor.fetchone()
    if row is None:
        raise CopilotError(500, "COPILOT_INTERNAL")
    return _as_dict(cursor, row)["id"]


async def insert_audit(
    conn: Any,
    *,
    user_id: int,
    session_id: int,
    message_id: int | None,
    tool_name: str | None,
    args_preview: str | None,
    result_preview: str | None,
    result_row_count: int | None,
    coverage: str,
    aborted: bool,
    numbers_ungrounded: int = 0,
    token_usage: Any = None,
) -> None:
    sql = (
        "INSERT INTO copilot.audit_log ("
        "user_id, session_id, message_id, tool_name, args_preview, result_preview, "
        "result_row_count, token_usage, coverage, aborted, numbers_ungrounded"
        ") VALUES ("
        "%(uid)s, %(sid)s, %(mid)s, %(tool_name)s, %(args_preview)s, %(result_preview)s, "
        "%(result_row_count)s, %(token_usage)s, %(coverage)s, %(aborted)s, %(numbers_ungrounded)s"
        ")"
    )
    await conn.execute(
        sql,
        {
            "uid": user_id,
            "sid": session_id,
            "mid": message_id,
            "tool_name": tool_name,
            "args_preview": args_preview,
            "result_preview": result_preview,
            "result_row_count": result_row_count,
            "token_usage": token_usage,
            "coverage": coverage,
            "aborted": aborted,
            "numbers_ungrounded": numbers_ungrounded,
        },
    )


async def touch_session(conn: Any, session_id: int) -> None:
    await conn.execute(
        "UPDATE copilot.sessions SET last_active=now() WHERE id=%(id)s",
        {"id": session_id},
    )
