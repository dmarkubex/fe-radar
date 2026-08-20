"""Copilot sidecar entrypoint. Logging is configured before any business import."""

from __future__ import annotations

from logging_config import configure_logging

configure_logging()

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg_pool import AsyncConnectionPool

from auth import HmacUser, require_hmac
from config import Settings, get_settings, make_pool
from memory import store
from memory.store import CopilotError, FeedbackBody

logger = logging.getLogger(__name__)


async def maybe_open_pool(settings: Settings) -> AsyncConnectionPool | None:
    pool = make_pool(settings)
    try:
        await pool.open()
        return pool
    except Exception:
        logger.warning("db pool unavailable")
        try:
            await pool.close()
        except Exception:
            pass
        return None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    app.state.settings = settings
    app.state.pool = await maybe_open_pool(settings)
    yield
    pool = getattr(app.state, "pool", None)
    if pool is not None:
        await pool.close()


app = FastAPI(lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(
    _request: Request,
    _exc: RequestValidationError,
) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": {"code": "COPILOT_BAD_REQUEST"}})


@app.exception_handler(CopilotError)
async def copilot_error_handler(_request: Request, exc: CopilotError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.code}})


@app.get("/healthz")
async def healthz(request: Request) -> dict[str, bool]:
    logger.info("healthz")
    pool = getattr(request.app.state, "pool", None)
    if pool is not None:
        try:
            async with pool.connection() as conn:
                await conn.execute("SELECT 1")
        except Exception:
            logger.warning("healthz SELECT 1 failed")
    return {"ok": True}


@app.get("/sessions")
async def list_sessions(
    request: Request,
    user: Annotated[HmacUser, Depends(require_hmac)],
) -> dict[str, list]:
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        return {"sessions": []}
    async with pool.connection() as conn:
        sessions = await store.list_sessions(conn, user.user_id)
    return {"sessions": sessions}


@app.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: int,
    request: Request,
    user: Annotated[HmacUser, Depends(require_hmac)],
) -> dict[str, list]:
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        raise CopilotError(503, "COPILOT_UNAVAILABLE")
    async with pool.connection() as conn:
        messages = await store.list_messages(conn, session_id, user.user_id)
    return {"messages": messages}


@app.post("/messages/{message_id}/feedback")
async def post_message_feedback(
    message_id: int,
    body: FeedbackBody,
    request: Request,
    user: Annotated[HmacUser, Depends(require_hmac)],
) -> dict:
    pool = getattr(request.app.state, "pool", None)
    if pool is None:
        raise CopilotError(503, "COPILOT_UNAVAILABLE")
    async with pool.connection() as conn:
        return await store.upsert_feedback(
            conn, message_id, user.user_id, body.rating, body.reason
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, log_config=None, access_log=False)
