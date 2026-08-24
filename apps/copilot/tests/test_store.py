from __future__ import annotations

from datetime import datetime, timezone

import pytest
from citations import citations_from_tool_runs, item_ids_from_tool_runs
from memory.store import (
    CopilotError,
    insert_assistant_message,
    list_messages,
    list_sessions,
    upsert_feedback,
)
from psycopg.types.json import Jsonb
from tests.fakes import FakeConn, FakePool, hmac_headers
from tools.registry import tracked, toolRunsVar


async def test_list_sessions_binds_uid_and_camelcase() -> None:
    conn = FakeConn()
    ts = datetime(2026, 8, 19, 16, 0, tzinfo=timezone.utc)
    conn.enqueue(
        rows=[(10, "A 的会话", "item", None, ts, ts)],
        colnames=["id", "title", "source", "item_id", "last_active", "created_at"],
    )
    sessions = await list_sessions(conn, 2)
    sql, params = conn.calls[0]
    assert "WHERE user_id=%(uid)s" in sql
    assert "ORDER BY last_active DESC" in sql
    assert params == {"uid": 2}
    assert sessions == [
        {
            "id": 10,
            "title": "A 的会话",
            "source": "item",
            "itemId": None,
            "lastActive": ts.isoformat(),
            "createdAt": ts.isoformat(),
        }
    ]


async def test_user_b_http_list_does_not_see_user_a(client) -> None:
    conn = FakeConn()
    conn.enqueue(rows=[], colnames=["id", "title", "source", "item_id", "last_active", "created_at"])
    client.app.state.pool = FakePool(conn)
    headers = hmac_headers("GET", "/sessions", b"", 99, "viewer")
    response = client.get("/sessions", headers=headers)
    assert response.status_code == 200
    assert response.json() == {"sessions": []}
    assert conn.calls[0][1] == {"uid": 99}


async def test_messages_not_owner_403(client) -> None:
    conn = FakeConn()
    conn.enqueue(rows=[], colnames=["id", "title", "source", "item_id", "last_active", "created_at"])
    client.app.state.pool = FakePool(conn)
    headers = hmac_headers("GET", "/sessions/7/messages", b"", 2, "viewer")
    response = client.get("/sessions/7/messages", headers=headers)
    assert response.status_code == 403
    assert response.json() == {"error": {"code": "COPILOT_NOT_OWNER"}}
    sql, params = conn.calls[0]
    assert "id=%(id)s AND user_id=%(uid)s" in sql
    assert params == {"id": 7, "uid": 2}


async def test_list_messages_recent_500_shape() -> None:
    conn = FakeConn()
    conn.enqueue(
        rows=[(7, "t", "ask", None, None, None)],
        colnames=["id", "title", "source", "item_id", "last_active", "created_at"],
    )
    conn.enqueue(
        rows=[(2, "assistant", "hello", [{"kind": "item", "itemId": 1}], None)],
        colnames=["id", "role", "content", "citations", "created_at"],
    )
    messages = await list_messages(conn, 7, 1)
    assert "WHERE session_id=%(sid)s" in conn.calls[1][0]
    assert conn.calls[1][1] == {"sid": 7}
    assert messages[0]["citations"][0]["kind"] == "item"


async def test_insert_assistant_message_wraps_nonempty_citations_in_jsonb() -> None:
    conn = FakeConn()
    conn.enqueue(rows=[(9,)], colnames=["id"])
    citations = [{"kind": "item", "itemId": 1}]

    message_id = await insert_assistant_message(conn, 7, "回答", citations)

    assert message_id == 9
    params = conn.calls[0][1]
    assert isinstance(params["citations"], Jsonb)
    assert params["citations"].obj is citations


async def test_feedback_upsert_200_not_409(client) -> None:
    conn = FakeConn()
    conn.enqueue(rows=[(5, "assistant", 1)], colnames=["id", "role", "user_id"])
    conn.enqueue(rows=[], colnames=[])
    client.app.state.pool = FakePool(conn)
    body = b'{"rating":-1}'
    headers = hmac_headers("POST", "/messages/5/feedback", body, 1, "viewer")
    response = client.post("/messages/5/feedback", headers=headers, content=body)
    assert response.status_code == 200
    assert response.json()["rating"] == -1
    upsert_sql, upsert_params = conn.calls[1]
    assert "ON CONFLICT (message_id, user_id) DO UPDATE" in upsert_sql
    assert upsert_params == {"mid": 5, "uid": 1, "rating": -1, "reason": None}


async def test_feedback_user_message_400() -> None:
    conn = FakeConn()
    conn.enqueue(rows=[(5, "user", 1)], colnames=["id", "role", "user_id"])
    with pytest.raises(CopilotError) as exc:
        await upsert_feedback(conn, 5, 1, 1, None)
    assert exc.value.status_code == 400
    assert exc.value.code == "COPILOT_FEEDBACK_NOT_ASSISTANT"


async def test_feedback_invalid_rating_400(client) -> None:
    body = b'{"rating":0}'
    headers = hmac_headers("POST", "/messages/5/feedback", body, 1, "viewer")
    response = client.post("/messages/5/feedback", headers=headers, content=body)
    assert response.status_code == 400
    assert response.json() == {"error": {"code": "COPILOT_BAD_REQUEST"}}


async def test_feedback_foreign_session_403() -> None:
    conn = FakeConn()
    conn.enqueue(rows=[], colnames=["id", "role", "user_id"])
    with pytest.raises(CopilotError) as exc:
        await upsert_feedback(conn, 5, 2, -1, "nope")
    assert exc.value.status_code == 403
    assert exc.value.code == "COPILOT_NOT_OWNER"
    assert conn.calls[0][1] == {"mid": 5, "uid": 2}


async def test_tool_runs_wrapper_records_success_and_failure() -> None:
    @tracked("demo")
    async def demo(*, q: str) -> dict:
        if q == "boom":
            raise RuntimeError("x")
        return {"ok": True, "rows": [{"q": q}]}

    token = toolRunsVar.set([])
    try:
        await demo(q="ok")
        await demo(q="boom")
        runs = toolRunsVar.get()
    finally:
        toolRunsVar.reset(token)
    assert runs[0] == {"name": "demo", "args": {"q": "ok"}, "result": {"ok": True, "rows": [{"q": "ok"}]}, "ok": True}
    assert runs[1]["ok"] is False
    assert runs[1]["result"]["reason"] == "ERROR"


def test_citations_fulltext_only_item_card() -> None:
    runs = [
        {
            "name": "fetch_fulltext",
            "args": {"itemId": 42},
            "ok": True,
            "result": {
                "ok": True,
                "itemId": 42,
                "content": "正文 80000",
                "truncated": False,
                "source": "stored",
                "title": "铜价观察",
                "summaryZh": "摘要",
                "scoredAt": "2026-08-19T00:00:00+08:00",
                "sourceName": "SMM",
            },
        }
    ]
    cards = citations_from_tool_runs(runs)
    assert cards == [
        {
            "kind": "item",
            "itemId": 42,
            "title": "铜价观察",
            "summaryZh": "摘要",
            "scoredAt": "2026-08-19T00:00:00+08:00",
            "sourceName": "SMM",
        }
    ]


def test_item_ids_from_tool_runs_keeps_ninth_beyond_card_cap() -> None:
    runs = []
    for i in range(1, 10):
        runs.append(
            {
                "name": "search_items",
                "args": {"q": "铜"},
                "ok": True,
                "result": {
                    "ok": True,
                    "rows": [
                        {
                            "id": i,
                            "title": f"条目{i}",
                            "summary_zh": "摘要",
                            "source_name": "SMM",
                        }
                    ],
                },
            }
        )
    cards = citations_from_tool_runs(runs)
    ids = item_ids_from_tool_runs(runs)
    assert [card["itemId"] for card in cards] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert ids == [1, 2, 3, 4, 5, 6, 7, 8, 9]
    assert 9 in ids
