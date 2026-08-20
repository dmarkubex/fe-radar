from __future__ import annotations

from contextlib import contextmanager

import httpx
import pytest
from agentscope.event import RequireUserConfirmEvent
from agentscope.message import UserMsg
from agentscope.types import ReplyFinishedReason
from agents.copilot_agent import build_agent, extract_text
from tests.fakes import FakeConn, ScriptedGateway, tool_call_then_text
from tools.registry import TOOL_NAMES, dbConnVar, toolRunsVar


@contextmanager
def tool_ctx(conn: FakeConn):
    runs_token = toolRunsVar.set([])
    db_token = dbConnVar.set(conn)
    try:
        yield
    finally:
        toolRunsVar.reset(runs_token)
        dbConnVar.reset(db_token)


@pytest.mark.asyncio
async def test_two_round_messages_include_tool_calls_and_tool_role() -> None:
    conn = FakeConn()
    conn.enqueue(
        rows=[(1, "铜价", "摘要", None, "SMM")],
        colnames=["id", "title", "summary_zh", "scored_at", "source_name"],
    )
    conn.enqueue(rows=[], colnames=["id", "canonical_name", "type"])
    model = ScriptedGateway(tool_call_then_text("get_item", '{"itemId":1}', "条目已查"))
    agent = build_agent(model)
    with tool_ctx(conn):
        msg = await agent.reply(UserMsg(name="user", content="这条是什么"))
    assert msg.finished_reason == ReplyFinishedReason.COMPLETED
    assert len(model.calls) == 2
    first = model.calls[0]["messages"]
    assert first[0]["role"] == "system"
    assert "只根据工具返回的结构化数据回答" in first[0]["content"]
    user_msgs = [m for m in first if m["role"] == "user" and m["content"] == "这条是什么"]
    assert len(user_msgs) == 1
    second = model.calls[1]["messages"]
    i = next(
        idx
        for idx, m in enumerate(second)
        if m.get("role") == "assistant" and m.get("tool_calls")
    )
    j = next(idx for idx, m in enumerate(second) if m.get("role") == "tool")
    assert i < j
    names = [t["function"]["name"] for t in model.calls[0]["tools"]]
    assert "reset_tools" not in names
    assert "Skill" not in names
    assert set(names) <= set(TOOL_NAMES)


@pytest.mark.asyncio
async def test_real_toolkit_fetch_fulltext_no_confirm_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict = {}

    class _Resp:
        def json(self) -> dict:
            return {
                "ok": True,
                "itemId": 1,
                "content": "全文正文",
                "truncated": False,
                "source": "stored",
                "title": "铜价",
                "summaryZh": "摘要",
                "scoredAt": "2026-08-19T00:00:00+08:00",
                "sourceName": "SMM",
            }

    class _Client:
        def __init__(self, *args, **kwargs):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return None

        async def post(self, url, json=None, headers=None):
            captured["url"] = url
            captured["json"] = json
            return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    model = ScriptedGateway(
        tool_call_then_text("fetch_fulltext", '{"itemId":1}', "全文如下")
    )
    agent = build_agent(model)
    events: list = []
    with tool_ctx(FakeConn()):
        async for ev in agent.reply_stream(
            UserMsg(name="user", content="看全文"),
            yield_final_msg=True,
        ):
            events.append(ev)
        runs = list(toolRunsVar.get() or [])
    assert not any(isinstance(ev, RequireUserConfirmEvent) for ev in events)
    assert not any(type(ev).__name__ == "RequireUserConfirmEvent" for ev in events)
    assert captured.get("json") == {"itemId": 1}
    assert any(run["name"] == "fetch_fulltext" and run["ok"] is True for run in runs)
    finals = [ev for ev in events if getattr(ev, "role", None) == "assistant"]
    assert finals
    assert extract_text(finals[-1])
