"""POST /chat lock state machine + SSE generator (design L380–410)."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from agentscope.message import UserMsg
from agentscope.state import AgentState
from agentscope.types import ReplyFinishedReason
from fastapi import Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agents.copilot_agent import (
    build_agent,
    extract_text,
    history_to_msgs,
    inject_pre_getitem,
)
from audit import rows_from_tool_runs
from auth import HmacUser
from citations import citations_from_tool_runs, item_ids_from_tool_runs
from config import Settings
from ground_numbers import REPLACE, ground_numbers, is_success_evidence, shanghai_calendar_day
from llm.gateway_client import WorkerGatewayError, WorkerGatewayModel
from memory.store import (
    CopilotError,
    acquire_turn_lock,
    assert_session_owner,
    create_session,
    insert_assistant_message,
    insert_audit,
    insert_user_message,
    item_is_visible,
    load_history_before,
    release_turn_lock,
    touch_session,
    visible_ids_of,
)
from tools.item import get_item
from tools.registry import dbConnVar, toolRunsVar

logger = logging.getLogger(__name__)

RADAR_UNCOVERED = "雷达未覆盖"
EXPIRED_PREFIX = "原条目已过期"
TURN_TIMEOUT_SEC = 120
MAX_MESSAGE_LEN = 4000

# T-CH-01: 备份路径释放锁的较短超时，避免孤儿 / 卡死的 conn 让 gen() 收尾被阻塞。
# 兜底是既有 15 分钟 `turn_locked_at` 陈旧回收，不是新机制。
_LOCK_BACKUP_RELEASE_SEC = 5.0


def _swallow_orphan_exception(task: asyncio.Task) -> None:
    """T-CH-01: 孤儿 task 兜异常回调。task.exception() 非 None 时记日志后吞掉，
    防止事件循环 default handler 打 "Task exception was never retrieved" 噪声。"""
    exc = task.exception()
    if exc is not None:
        logger.warning("orphan turn task raised: %s", exc)

class _TurnAbort(Exception):
    def __init__(self, code: str) -> None:
        self.code = code


class ChatBody(BaseModel):
    message: str
    sessionId: int | None = None
    itemId: int | None = None


class PooledConnProxy:
    def __init__(self, pool: Any) -> None:
        self._pool = pool

    async def execute(self, sql: str, params: dict | None = None) -> Any:
        async with self._pool.connection() as conn:
            return await conn.execute(sql, params)


def build_model(settings: Settings, correlation_id: str) -> WorkerGatewayModel:
    return WorkerGatewayModel(
        worker_base_url=settings.worker_internal_url,
        service_token=settings.service_token_worker,
        correlation_id=correlation_id,
        context_size=settings.copilot_llm_context_size,
    )


def sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def cutoff_date_from_runs(runs: list) -> str | None:
    scored_or_date: list[str] = []
    observed: list[str] = []
    fetched: list[str] = []
    for run in runs:
        if not is_success_evidence(run):
            continue
        result = run.get("result")
        blobs: list[Any] = [result] if isinstance(result, dict) else []
        if isinstance(result, dict) and isinstance(result.get("rows"), list):
            blobs.extend(result["rows"])
        for obj in blobs:
            if not isinstance(obj, dict):
                continue
            for key in ("scoredAt", "scored_at", "date"):
                raw = obj.get(key)
                if raw:
                    day = shanghai_calendar_day(str(raw))
                    if day:
                        scored_or_date.append(day)
            raw_obs = obj.get("observedAt", obj.get("observed_at"))
            if raw_obs:
                day = shanghai_calendar_day(str(raw_obs))
                if day:
                    observed.append(day)
            raw_fet = obj.get("fetchedAt", obj.get("fetched_at"))
            if raw_fet:
                day = shanghai_calendar_day(str(raw_fet))
                if day:
                    fetched.append(day)
    candidates = list(scored_or_date)
    candidates.extend(observed if observed else fetched)
    return max(candidates) if candidates else None


async def resolve_session(
    conn: Any,
    user: HmacUser,
    body: ChatBody,
    title: str,
) -> dict:
    if body.sessionId is None:
        if body.itemId is not None:
            if not await item_is_visible(conn, body.itemId):
                raise CopilotError(404, "COPILOT_ITEM_NOT_FOUND")
            return await create_session(conn, user.user_id, "item", body.itemId, title)
        return await create_session(conn, user.user_id, "ask", None, title)

    session = await assert_session_owner(conn, body.sessionId, user.user_id)
    if body.itemId is not None:
        source = session.get("source")
        existing = session.get("item_id")
        if source == "ask":
            raise CopilotError(400, "COPILOT_ITEM_CONFLICT")
        if existing is None or existing != body.itemId:
            raise CopilotError(400, "COPILOT_ITEM_CONFLICT")
    return session


async def _write_aborted_audit(pool: Any, user_id: int, session_id: int, runs: list) -> None:
    async with pool.connection() as conn:
        async with conn.transaction():
            for row in rows_from_tool_runs(runs):
                await insert_audit(
                    conn,
                    user_id=user_id,
                    session_id=session_id,
                    message_id=None,
                    tool_name=row.get("tool_name"),
                    args_preview=row.get("args_preview"),
                    result_preview=row.get("result_preview"),
                    result_row_count=row.get("result_row_count"),
                    coverage="none",
                    aborted=True,
                )
            await insert_audit(
                conn,
                user_id=user_id,
                session_id=session_id,
                message_id=None,
                tool_name=None,
                args_preview=None,
                result_preview="该轮不生成结论",
                result_row_count=None,
                coverage="none",
                aborted=True,
            )


async def post_chat(request: Request, user: HmacUser, body: ChatBody) -> StreamingResponse:
    correlation_id = uuid4().hex
    logger.info("request_started", extra={"correlationId": correlation_id})
    message = body.message
    if not message.strip() or len(message) > MAX_MESSAGE_LEN:
        raise CopilotError(400, "COPILOT_BAD_REQUEST")

    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        raise CopilotError(503, "COPILOT_UNAVAILABLE")
    settings: Settings = request.app.state.settings

    title = message[:30]
    async with pool.connection() as conn:
        session = await resolve_session(conn, user, body, title)
    session_id = int(session["id"])
    source = session.get("source")
    item_id = session.get("item_id")
    expired_item = source == "item" and item_id is None
    bind_item_id = item_id if source == "item" and item_id is not None else None

    ts = datetime.now(timezone.utc)
    async with pool.connection() as conn:
        locked = await acquire_turn_lock(conn, session_id, ts)
    if locked is None:
        raise CopilotError(409, "COPILOT_TURN_IN_PROGRESS")

    try:
        async with pool.connection() as conn:
            user_message_id = await insert_user_message(conn, session_id, message)
    except Exception:
        async with pool.connection() as conn:
            await release_turn_lock(conn, session_id, ts)
        raise CopilotError(500, "COPILOT_INTERNAL") from None

    async def gen() -> AsyncIterator[str]:
        runs_token = toolRunsVar.set([])
        db_token = dbConnVar.set(PooledConnProxy(pool))
        error_code: str | None = None
        coverage = "none"

        async def _release_lock_backup(lock_ts):
            """T-CH-01: 备份路径释放锁。与主路径使用同一个 `ts`（CAS 保证双重释放安全）。
            用较短超时（5s）防止孤儿任务占用的 conn 让 gen() 收尾被阻塞；
            失败则记结构化日志后放弃（兜底是既有 15 分钟陈旧回收）。"""
            try:
                async with pool.connection() as conn2:
                    try:
                        await asyncio.wait_for(
                            release_turn_lock(conn2, session_id, lock_ts),
                            timeout=_LOCK_BACKUP_RELEASE_SEC,
                        )
                    except asyncio.TimeoutError:
                        logger.warning(
                            "backup lock release timeout; relying on stale recovery",
                            extra={"correlationId": correlation_id},
                        )
            except Exception as exc:  # pragma: no cover — 池关闭等极端情况
                logger.warning(
                    "backup lock release failed: %s", exc,
                    extra={"correlationId": correlation_id},
                )

        try:
            yield sse({"type": "tool", "data": {"name": "_ack", "sessionId": session_id}})
            logger.info("first_event", extra={"correlationId": correlation_id})

            state = AgentState()
            async with pool.connection() as conn:
                history = await load_history_before(conn, session_id, user_message_id)
            history.reverse()
            state.context = history_to_msgs(history)

            if bind_item_id is not None:
                bound = await get_item(itemId=bind_item_id)
                if bound.get("ok") is True:
                    inject_pre_getitem(state, bind_item_id, bound)

            model = build_model(settings, correlation_id)
            agent = build_agent(model, state=state)
            user_msg = UserMsg(name="user", content=message)

            async def _reply_ground_and_persist() -> tuple[str, list, str, int]:
                reply_msg = await agent.reply(user_msg)
                if reply_msg.finished_reason != ReplyFinishedReason.COMPLETED:
                    raise _TurnAbort("COPILOT_ABORTED")
                local_runs = list(toolRunsVar.get() or [])
                local_cards = citations_from_tool_runs(local_runs)
                if any(is_success_evidence(run) for run in local_runs):
                    ids = item_ids_from_tool_runs(local_runs)
                    if ids:
                        async with pool.connection() as conn:
                            visible = await visible_ids_of(conn, ids)
                        if any(item not in visible for item in ids):
                            raise _TurnAbort("COPILOT_ITEM_NOT_VISIBLE")
                    local_answer = ground_numbers(extract_text(reply_msg), local_runs)
                    cutoff = cutoff_date_from_runs(local_runs)
                    if cutoff:
                        local_answer = local_answer.rstrip() + f"\n数据截止：{cutoff}"
                    local_coverage = "ok"
                else:
                    local_answer = RADAR_UNCOVERED
                    local_cards = []
                    local_coverage = "none"
                if expired_item:
                    local_answer = f"{EXPIRED_PREFIX}\n{local_answer}"
                ungrounded = local_answer.count(REPLACE)
                async with pool.connection() as conn:
                    async with conn.transaction():
                        local_assistant_id = await insert_assistant_message(
                            conn, session_id, local_answer, local_cards
                        )
                        for row in rows_from_tool_runs(local_runs):
                            await insert_audit(
                                conn,
                                user_id=user.user_id,
                                session_id=session_id,
                                message_id=local_assistant_id,
                                tool_name=row.get("tool_name"),
                                args_preview=row.get("args_preview"),
                                result_preview=row.get("result_preview"),
                                result_row_count=row.get("result_row_count"),
                                coverage=local_coverage,
                                aborted=False,
                                numbers_ungrounded=ungrounded,
                            )
                        await insert_audit(
                            conn,
                            user_id=user.user_id,
                            session_id=session_id,
                            message_id=local_assistant_id,
                            tool_name=None,
                            args_preview=None,
                            result_preview=local_answer[:500],
                            result_row_count=None,
                            coverage=local_coverage,
                            aborted=False,
                            numbers_ungrounded=ungrounded,
                        )
                        await touch_session(conn, session_id)
                return local_answer, local_cards, local_coverage, local_assistant_id
            # T-CH-01: 用 `asyncio.wait` 替换 `asyncio.wait_for` 实现会话级看门狗。
            # `wait_for` 在目标协程吞掉取消信号时跟着卡死（两次生产事故根因）；
            # `wait` 到点一定返回，由调用方决定后续动作。
            inner_task = asyncio.create_task(
                _reply_ground_and_persist(),
                name=f"copilot-turn-{session_id}-{correlation_id[:8]}",
            )
            try:
                done, pending = await asyncio.wait({inner_task}, timeout=TURN_TIMEOUT_SEC)
            except BaseException:
                # 客户端断连（GeneratorExit / CancelledError）或其他异常：
                # 显式取消内层任务（保留 wait_for 原有的断连即链式取消语义）；
                # 若协程无视取消，结果与看门狗路径相同（成为孤儿，done callback 兜异常）。
                if not inner_task.done():
                    inner_task.cancel()
                    inner_task.add_done_callback(_swallow_orphan_exception)
                raise
            if pending:
                # 看门狗到点。orphan task 不取消（不保证能杀死挂死协程）；
                # 必须挂 done_callback 吞异常，不留 "Task exception was never retrieved" 噪声。
                inner_task.add_done_callback(_swallow_orphan_exception)
                error_code = "COPILOT_TURN_TIMEOUT"
                await _write_aborted_audit(
                    pool,
                    user.user_id,
                    session_id,
                    list(toolRunsVar.get() or []),
                )
                if not await request.is_disconnected():
                    yield sse({"type": "error", "data": {"code": error_code}})
                # 备份路径：用独立连接释放锁，与主路径（finally）使用的 ts 闭包相同。
                # 主路径可能因孤儿占用 / 死锁阻塞；备份路径用较短超时保护，失败放弃不阻塞 gen() 收尾。
                await _release_lock_backup(ts)
                return
            assert inner_task in done
            # 正常完成：从 task 取结果（异常也由 except 分支处理）
            exc = inner_task.exception()
            if exc is None:
                answer, cards, coverage, assistant_id = inner_task.result()
                yield sse({"type": "token", "data": answer})
                logger.info("first_answer_token", extra={"correlationId": correlation_id})
                yield sse({"type": "citation", "data": cards})
                yield sse(
                    {
                        "type": "done",
                        "data": {
                            "sessionId": session_id,
                            "assistantMessageId": assistant_id,
                        },
                    }
                )
                return
            # 任务内抛异常：按既有 except 分支处理
            if isinstance(exc, _TurnAbort):
                error_code = exc.code
            elif isinstance(exc, WorkerGatewayError):
                error_code = exc.code
            elif isinstance(exc, asyncio.CancelledError):
                error_code = "COPILOT_CANCELLED"
            else:
                error_code = "COPILOT_INTERNAL"
            await _write_aborted_audit(
                pool,
                user.user_id,
                session_id,
                list(toolRunsVar.get() or []),
            )
            if not await request.is_disconnected() and error_code != "COPILOT_CANCELLED":
                yield sse({"type": "error", "data": {"code": error_code}})
            return
        finally:
            try:
                toolRunsVar.reset(runs_token)
            finally:
                dbConnVar.reset(db_token)
            # 主路径：用原 conn 释放锁（与 acquire_turn_lock 同一个 ts）。
            # 与备份路径是 CAS 双保险（详见 `_release_lock_backup`）。
            async with pool.connection() as conn:
                await release_turn_lock(conn, session_id, ts)
            logger.info(
                "completed",
                extra={
                    "correlationId": correlation_id,
                    "coverage": coverage,
                    "errorCode": error_code,
                },
            )

    return StreamingResponse(gen(), media_type="text/event-stream")
