from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from agentscope.message import TextBlock
from agentscope.model import ChatResponse
from llm.gateway_client import WorkerGatewayModel
from tests.fakes import (
    ChatFakeConn,
    FakePool,
    ScriptedGateway,
    hmac_headers,
    text_only,
    tool_call_then_text,
)


def _post_headers(body: bytes, user_id: int = 7, role: str = "viewer") -> dict[str, str]:
    headers = hmac_headers("POST", "/chat", body, user_id, role)
    headers["content-type"] = "application/json"
    return headers


def _parse_sse(text: str) -> list[dict]:
    events: list[dict] = []
    for part in text.split("\n\n"):
        for line in part.split("\n"):
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


def _chat(client, conn: ChatFakeConn, payload: dict, *, user_id: int = 7):
    client.app.state.pool = FakePool(conn)
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return client.post("/chat", content=body, headers=_post_headers(body, user_id))


def test_watchdog_covers_persist_not_sse() -> None:
    """T-CH-01: 源码级断言 — `asyncio.wait` 看门狗包住 reply/ground/persist 全部落库路径，
    且 gen() 内 `_reply_ground_and_persist` 主体不含任何 SSE yield（发帧在 wait 之后）。"""
    text = Path(__file__).resolve().parents[1].joinpath("chat.py").read_text()
    start = text.index("async def _reply_ground_and_persist")
    wait_call = text.index("_reply_ground_and_persist(),")
    body = text[start:wait_call]
    assert "agent.reply" in body
    assert "visible_ids_of" in body
    assert "ground_numbers" in body
    assert "insert_assistant_message" in body
    assert "insert_audit" in body
    assert "yield sse" not in body
    # T-CH-01: 看门狗用 asyncio.wait（不是 wait_for），断言两者都存在
    assert "asyncio.wait({" in text
    assert "asyncio.wait_for(\n                    _reply_ground_and_persist()" not in text

def test_chat_hmac_wrong_still_401(client) -> None:
    body = b'{"message":"hi"}'
    headers = _post_headers(body)
    headers["x-fer-internal-auth"] = "0" * 64
    response = client.post("/chat", content=body, headers=headers)
    assert response.status_code == 401
    assert "event-stream" not in response.headers.get("content-type", "")


def test_chat_empty_message_400_not_sse(client) -> None:
    conn = ChatFakeConn()
    response = _chat(client, conn, {"message": ""})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "COPILOT_BAD_REQUEST"
    assert "event-stream" not in response.headers.get("content-type", "")
    assert conn.turn_locked_at is None
    assert conn.user_inserts == []


def test_insert_user_error_unlocks_second_post_not_409(
    client, monkeypatch: pytest.MonkeyPatch
) -> None:
    conn = ChatFakeConn()
    conn.raise_on_user_insert = True
    monkeypatch.setattr("chat.build_model", lambda *_a, **_k: ScriptedGateway(text_only("x")))
    first = _chat(client, conn, {"message": "你好"})
    assert first.status_code == 500
    assert first.json()["error"]["code"] == "COPILOT_INTERNAL"
    assert "event-stream" not in first.headers.get("content-type", "")
    assert conn.turn_locked_at is None
    conn.raise_on_user_insert = False
    second = _chat(client, conn, {"message": "你好"})
    assert second.status_code != 409
    assert second.status_code == 200


def test_zero_tools_shows_radar_uncovered(client, monkeypatch: pytest.MonkeyPatch) -> None:
    conn = ChatFakeConn()
    monkeypatch.setattr(
        "chat.build_model",
        lambda *_a, **_k: ScriptedGateway(text_only("模型瞎编 80000")),
    )
    response = _chat(client, conn, {"message": "铜价多少"})
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    events = _parse_sse(response.text)
    types = [ev["type"] for ev in events]
    assert types[0] == "tool"
    assert events[0]["data"]["name"] == "_ack"
    tokens = [ev["data"] for ev in events if ev["type"] == "token"]
    assert tokens == ["雷达未覆盖"]
    assert any(ev["type"] == "done" for ev in events)
    assert conn.assistant_inserts
    assert conn.assistant_inserts[0]["content"] == "雷达未覆盖"
    assert any(row.get("coverage") == "none" and row.get("aborted") is False for row in conn.audit_inserts)


def test_tool_round_yields_grounded_answer(client, monkeypatch: pytest.MonkeyPatch) -> None:
    conn = ChatFakeConn()
    monkeypatch.setattr(
        "chat.build_model",
        lambda *_a, **_k: ScriptedGateway(
            tool_call_then_text("get_item", '{"itemId":1}', "铜价摘要见条目")
        ),
    )
    response = _chat(client, conn, {"message": "这条是什么"})
    assert response.status_code == 200
    events = _parse_sse(response.text)
    tokens = [ev["data"] for ev in events if ev["type"] == "token"]
    assert tokens
    assert "雷达未覆盖" not in tokens[0]
    assert "数据截止：2026-08-19" in tokens[0]
    done = [ev for ev in events if ev["type"] == "done"]
    assert done[0]["data"]["sessionId"] == 1
    assert done[0]["data"]["assistantMessageId"] == conn.assistant_message_id
    cite = [ev for ev in events if ev["type"] == "citation"]
    assert cite[0]["data"][0]["kind"] == "item"


def test_locked_session_second_post_409(client, monkeypatch: pytest.MonkeyPatch) -> None:
    conn = ChatFakeConn()
    conn.turn_locked_at = datetime.now(timezone.utc)
    monkeypatch.setattr("chat.build_model", lambda *_a, **_k: ScriptedGateway(text_only("x")))
    response = _chat(client, conn, {"message": "第二轮"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "COPILOT_TURN_IN_PROGRESS"
    assert "event-stream" not in response.headers.get("content-type", "")
    assert conn.user_inserts == []


def test_cancel_during_call_api_aborts_no_assistant(
    client, monkeypatch: pytest.MonkeyPatch
) -> None:
    conn = ChatFakeConn()

    class CancellingGateway(WorkerGatewayModel):
        def __init__(self) -> None:
            super().__init__(worker_base_url="http://worker:8071", service_token="t")

        async def _call_api(self, model_name, messages, tools=None, tool_choice=None, **kwargs):
            async def _stream():
                yield ChatResponse(content=[TextBlock(text="x")], is_last=False)
                raise asyncio.CancelledError()

            return _stream()

    monkeypatch.setattr("chat.build_model", lambda *_a, **_k: CancellingGateway())
    response = _chat(client, conn, {"message": "取消"})
    assert response.status_code == 200
    events = _parse_sse(response.text)
    assert events[0]["type"] == "tool"
    assert not any(ev["type"] == "done" for ev in events)
    assert conn.assistant_inserts == []
    assert any(row.get("aborted") is True and row.get("tool_name") is None for row in conn.audit_inserts)
    assert conn.turn_locked_at is None
