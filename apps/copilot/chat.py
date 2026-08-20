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

            try:
                reply_msg = await asyncio.wait_for(agent.reply(user_msg), timeout=TURN_TIMEOUT_SEC)
            except asyncio.TimeoutError:
                error_code = "COPILOT_TURN_TIMEOUT"
                await _write_aborted_audit(pool, user.user_id, session_id, list(toolRunsVar.get() or []))
                if not await request.is_disconnected():
                    yield sse({"type": "error", "data": {"code": error_code}})
                return
            except asyncio.CancelledError:
                error_code = "COPILOT_CANCELLED"
                await _write_aborted_audit(pool, user.user_id, session_id, list(toolRunsVar.get() or []))
                return
            except WorkerGatewayError as exc:
                error_code = exc.code
                await _write_aborted_audit(pool, user.user_id, session_id, list(toolRunsVar.get() or []))
                if not await request.is_disconnected():
                    yield sse({"type": "error", "data": {"code": error_code}})
                return
            except Exception:
                error_code = "COPILOT_INTERNAL"
                await _write_aborted_audit(pool, user.user_id, session_id, list(toolRunsVar.get() or []))
                if not await request.is_disconnected():
                    yield sse({"type": "error", "data": {"code": error_code}})
                return

            if reply_msg.finished_reason != ReplyFinishedReason.COMPLETED:
                error_code = "COPILOT_ABORTED"
                await _write_aborted_audit(pool, user.user_id, session_id, list(toolRunsVar.get() or []))
                if not await request.is_disconnected():
                    yield sse({"type": "error", "data": {"code": error_code}})
                return

            runs = list(toolRunsVar.get() or [])
            cards = citations_from_tool_runs(runs)
            if any(is_success_evidence(run) for run in runs):
                ids = item_ids_from_tool_runs(runs)
                if ids:
                    async with pool.connection() as conn:
                        visible = await visible_ids_of(conn, ids)
                    if any(item not in visible for item in ids):
                        error_code = "COPILOT_ITEM_NOT_VISIBLE"
                        await _write_aborted_audit(pool, user.user_id, session_id, runs)
                        if not await request.is_disconnected():
                            yield sse({"type": "error", "data": {"code": error_code}})
                        return
                answer = ground_numbers(extract_text(reply_msg), runs)
                cutoff = cutoff_date_from_runs(runs)
                if cutoff:
                    answer = answer.rstrip() + f"\n数据截止：{cutoff}"
                coverage = "ok"
            else:
                answer = RADAR_UNCOVERED
                cards = []
                coverage = "none"

            if expired_item:
                answer = f"{EXPIRED_PREFIX}\n{answer}"

            yield sse({"type": "token", "data": answer})
            logger.info("first_answer_token", extra={"correlationId": correlation_id})

            if await request.is_disconnected():
                error_code = "COPILOT_CANCELLED"
                await _write_aborted_audit(pool, user.user_id, session_id, runs)
                return

            ungrounded = answer.count(REPLACE)
            async with pool.connection() as conn:
                async with conn.transaction():
                    assistant_id = await insert_assistant_message(conn, session_id, answer, cards)
                    for row in rows_from_tool_runs(runs):
                        await insert_audit(
                            conn,
                            user_id=user.user_id,
                            session_id=session_id,
                            message_id=assistant_id,
                            tool_name=row.get("tool_name"),
                            args_preview=row.get("args_preview"),
                            result_preview=row.get("result_preview"),
                            result_row_count=row.get("result_row_count"),
                            coverage=coverage,
                            aborted=False,
                            numbers_ungrounded=ungrounded,
                        )
                    await insert_audit(
                        conn,
                        user_id=user.user_id,
                        session_id=session_id,
                        message_id=assistant_id,
                        tool_name=None,
                        args_preview=None,
                        result_preview=answer[:500],
                        result_row_count=None,
                        coverage=coverage,
                        aborted=False,
                        numbers_ungrounded=ungrounded,
                    )
                    await touch_session(conn, session_id)

            yield sse({"type": "citation", "data": cards})
            yield sse(
                {
                    "type": "done",
                    "data": {"sessionId": session_id, "assistantMessageId": assistant_id},
                }
            )
        finally:
            try:
                toolRunsVar.reset(runs_token)
            finally:
                dbConnVar.reset(db_token)
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
