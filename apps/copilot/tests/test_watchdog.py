"""T-CH-01 回归：copilot 会话级看门狗（asyncio.wait）+ turn_lock 释放与竞态防护。

验收标准 6（goal.md）：
- 基本场景：看门狗到点触发 → turn_locked_at 清空 → 同 session 下一次 /chat 能重新拿锁。
- 竞态场景：ts1 释放 → ts2 重新拿锁 → 迟到的 ts1 释放 → 空操作，turn_locked_at 仍为 ts2。
- 独立连接断言：备份路径 release_turn_lock 的连接对象 ≠ gen() 主路径连接（对象身份级）。
- 断连取消断言：客户端断连 → 内层 task 被 cancel、锁经 finally 释放、
  孤儿 done callback 已挂接且无未取出异常。

fake 边界说明：本文件测的是 chat.py 看门狗/锁语义，不是 _call_api 的压缩放行分支
（那是 test_compression.py 的职责，其 fake 边界下移到 httpx.MockTransport）；
这里沿用 ScriptedGateway / 挂死模型覆写 _call_api 是既有模式，不违反验收标准 1。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from agentscope.message import TextBlock
from agentscope.model import ChatResponse

from auth import HmacUser
from chat import ChatBody, post_chat
from llm.gateway_client import WorkerGatewayModel
from memory.store import release_turn_lock
from tests.fakes import ChatFakeConn, DistinctConnPool, FakePool, ScriptedGateway, text_only


class HangingGateway(WorkerGatewayModel):
    """_call_api 返回的流在首个 chunk 后挂死（await 永不完成的 sleep），模拟生产挂死；
    对 cancel 响应（记录 cancelled 标志后 re-raise），供断连取消断言。"""

    def __init__(self) -> None:
        super().__init__(worker_base_url="http://worker:8071", service_token="t")
        self.cancelled = False

    async def _call_api(self, model_name, messages, tools=None, tool_choice=None, **kwargs):
        async def _stream():
            yield ChatResponse(content=[TextBlock(text="x")], is_last=False)
            try:
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                self.cancelled = True
                raise

        return _stream()


class _FakeRequest:
    """最小 Request 替身：post_chat 只用 app.state.pool/settings 与 is_disconnected()。"""

    def __init__(self, pool) -> None:
        self.state = SimpleNamespace(pool=pool, settings=SimpleNamespace())
        self.app = SimpleNamespace(state=self.state)

    async def is_disconnected(self) -> bool:
        return False


async def _consume_sse(gen) -> str:
    chunks: list[str] = []
    async for chunk in gen:
        chunks.append(chunk)
    return "".join(chunks)


def _parse_events(text: str) -> list[dict]:
    return [json.loads(line[6:]) for line in text.split("\n") if line.startswith("data: ")]


async def _run_turn(pool, model, monkeypatch, timeout_sec: float) -> str:
    import chat as chat_mod

    monkeypatch.setattr(chat_mod, "TURN_TIMEOUT_SEC", timeout_sec)
    monkeypatch.setattr(chat_mod, "build_model", lambda *_a, **_k: model)
    response = await post_chat(
        _FakeRequest(pool), HmacUser(user_id=7, role="viewer"), ChatBody(message="铜价")
    )
    return await _consume_sse(response.body_iterator)


def _spy_orphan_callback(monkeypatch) -> list[asyncio.Task]:
    """记录 `_swallow_orphan_exception` 的每次调用（保持原行为）。"""
    import chat as chat_mod

    seen: list[asyncio.Task] = []
    original = chat_mod._swallow_orphan_exception

    def spy(task: asyncio.Task) -> None:
        seen.append(task)
        original(task)

    monkeypatch.setattr(chat_mod, "_swallow_orphan_exception", spy)
    return seen


async def _cancel_orphans() -> None:
    """测试层清理：看门狗路径有意不取消孤儿（生产语义）；测试结束前取消，
    避免事件循环关闭时 "Task was destroyed but it is pending" 噪声。
    孤儿已挂 done callback（吞异常），取消不会产生未取出异常。"""
    for task in asyncio.all_tasks():
        if task.get_name().startswith("copilot-turn-") and not task.done():
            task.cancel()
    await asyncio.sleep(0.05)  # 让 cancel 送达 + done callback 执行


# ---------------------------------------------------------------------------
# 基本场景 + 独立连接断言（同一测试流覆盖：到点 → 错误帧 → 双路径释放 → 重拿锁）
# ---------------------------------------------------------------------------


async def test_watchdog_timeout_releases_lock_and_next_post_succeeds(monkeypatch):
    callback_seen = _spy_orphan_callback(monkeypatch)
    conn = ChatFakeConn()
    pool = DistinctConnPool(conn)
    text = await _run_turn(pool, HangingGateway(), monkeypatch, timeout_sec=0.2)

    events = _parse_events(text)
    errors = [e for e in events if e["type"] == "error"]
    assert errors and errors[0]["data"]["code"] == "COPILOT_TURN_TIMEOUT"
    assert not any(e["type"] == "done" for e in events)
    # 锁已被清空（主路径 finally 或备份路径之一）
    assert conn.turn_locked_at is None

    # 独立连接断言：两次锁释放（备份路径 + 主路径 finally）走了不同的连接对象
    release_delegates = [
        d
        for d in pool.acquired_delegates
        if any("set turn_locked_at=null" in " ".join(s.split()).lower() for s in d.executed)
    ]
    assert len(release_delegates) == 2, (
        f"期望备份路径与主路径恰好两次释放；实际 {len(release_delegates)} 次"
    )
    assert release_delegates[0] is not release_delegates[1], (
        "备份路径与主路径释放锁使用了同一个连接对象"
    )

    # 下一次同 session /chat 能重新拿锁（不被残留锁卡成 409）
    second = await _run_turn(pool, ScriptedGateway(text_only("ok")), monkeypatch, timeout_sec=30.0)
    assert not any(e["type"] == "error" for e in _parse_events(second))

    # 孤儿 done callback 已挂接且不抛（清理孤儿时 callback 对 cancelled task 静默返回）
    await _cancel_orphans()
    assert callback_seen, "孤儿 done callback 未被调用"
    assert all(t.done() for t in callback_seen)


# ---------------------------------------------------------------------------
# 竞态场景（CAS）：迟到的 ts1 释放不会误释放 ts2 的锁
# ---------------------------------------------------------------------------


async def test_late_release_with_stale_ts_is_noop():
    conn = ChatFakeConn()
    ts1 = datetime.now(timezone.utc)
    ts2 = ts1 + timedelta(seconds=1)

    # 模拟：看门狗用 ts1 释放（第一次成功）
    conn.turn_locked_at = ts1
    await release_turn_lock(conn, 1, ts1)
    assert conn.turn_locked_at is None

    # 新请求用 ts2 重新拿锁
    conn.turn_locked_at = ts2

    # 迟到的 ts1 释放（主路径与备份路径中较晚到达的那一次）→ CAS 空操作
    await release_turn_lock(conn, 1, ts1)
    assert conn.turn_locked_at == ts2, "迟到的 ts1 释放误清了新一轮 ts2 的锁"


# ---------------------------------------------------------------------------
# 断连取消：客户端断连 → 内层 task cancel + finally 释放锁 + done callback 挂接
# ---------------------------------------------------------------------------


async def test_client_disconnect_cancels_inner_task_and_releases_lock(monkeypatch):
    import chat as chat_mod

    callback_seen = _spy_orphan_callback(monkeypatch)
    conn = ChatFakeConn()
    pool = FakePool(conn)
    model = HangingGateway()
    monkeypatch.setattr(chat_mod, "TURN_TIMEOUT_SEC", 30.0)
    monkeypatch.setattr(chat_mod, "build_model", lambda *_a, **_k: model)

    response = await post_chat(
        _FakeRequest(pool), HmacUser(user_id=7, role="viewer"), ChatBody(message="铜价")
    )
    gen = response.body_iterator

    # 用独立任务驱动 gen（生产中 StreamingResponse 的迭代同样跑在请求任务里）：
    # 消费 _ack 帧后，gen 继续执行到 `await asyncio.wait(...)` 处挂起。
    consumer = asyncio.create_task(_consume_sse(gen))
    inner: asyncio.Task | None = None
    for _ in range(200):
        inner = next(
            (t for t in asyncio.all_tasks() if t.get_name().startswith("copilot-turn-")),
            None,
        )
        if inner is not None:
            break
        await asyncio.sleep(0.01)
    assert inner is not None, "gen 未到达 asyncio.wait（内层 task 未创建）"

    # 模拟客户端断连：取消正在驱动 gen 的任务。
    # CancelledError 落在 gen 内部最深的 await 点（asyncio.wait 处），
    # 与 Starlette/uvicorn 断连时取消请求任务的传播路径一致。
    consumer.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await consumer

    # 内层 task 已被显式 cancel（HangingGateway 记录到 CancelledError）
    for _ in range(50):
        if model.cancelled:
            break
        await asyncio.sleep(0.02)
    assert model.cancelled, "断连后内层 task 未被 cancel"

    # 锁经 finally 路径释放
    assert conn.turn_locked_at is None
    # 孤儿 done callback 已挂接且无未取出异常：callback 已执行（异常在 callback 内
    # 被 task.exception() 取出并记日志——本例 agentscope 将取消转为 INTERRUPTED 结束，
    # task 以 _TurnAbort 异常完成；取消直达 task 的情形由下方直测覆盖）
    for _ in range(50):
        if callback_seen:
            break
        await asyncio.sleep(0.02)
    assert callback_seen, "断连路径未挂接 done callback"
    assert all(t.done() for t in callback_seen)


async def test_orphan_callback_swallows_cancelled_task():
    """cancelled task 的 exception() 抛 CancelledError；callback 必须静默返回，
    不让异常砸进事件循环 default handler（goal.md 范围第 0 条）。"""
    import chat as chat_mod

    async def _hang():
        await asyncio.sleep(3600)

    task = asyncio.create_task(_hang())
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    # 被测行为：对 cancelled task 调用不抛
    chat_mod._swallow_orphan_exception(task)
