"""toolRuns ContextVar + per-tool wrapper (design §3.2.1-d)."""

from __future__ import annotations

from contextvars import ContextVar
from datetime import date, datetime
from functools import wraps
from typing import Any, Awaitable, Callable

# 无 default。禁止把可变空 list 当作 ContextVar 默认值（会串请求）。
toolRunsVar: ContextVar[list | None] = ContextVar("toolRunsVar")
dbConnVar: ContextVar[Any] = ContextVar("dbConnVar")

DEFAULT_LIMIT = 10
MAX_LIMIT = 20
DEFAULT_DAYS = 30
MAX_DAYS = 90

ToolFn = Callable[..., Awaitable[dict]]


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    try:
        n = int(limit)
    except (TypeError, ValueError):
        return DEFAULT_LIMIT
    return max(1, min(MAX_LIMIT, n))


def clamp_days(days: int | None) -> int:
    if days is None:
        return DEFAULT_DAYS
    try:
        n = int(days)
    except (TypeError, ValueError):
        return DEFAULT_DAYS
    return max(1, min(MAX_DAYS, n))


def ok_rows(rows: list) -> dict:
    return {"ok": True, "rows": rows}


def fail(reason: str, **extra: Any) -> dict:
    return {"ok": False, "reason": reason, **extra}


def get_conn() -> Any:
    return dbConnVar.get()


def row_dict(cursor: Any, row: Any) -> dict:
    if isinstance(row, dict):
        return row
    mapping = getattr(row, "_mapping", None)
    if mapping is not None:
        return dict(mapping)
    names = [col.name for col in (cursor.description or [])]
    return dict(zip(names, row, strict=False))


def iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def record_run(name: str, args: dict, result: dict) -> None:
    try:
        runs = toolRunsVar.get()
    except LookupError:
        return
    if runs is None:
        return
    runs.append(
        {
            "name": name,
            "args": args,
            "result": result,
            "ok": bool(isinstance(result, dict) and result.get("ok") is True),
        }
    )


def tracked(name: str) -> Callable[[ToolFn], ToolFn]:
    def deco(fn: ToolFn) -> ToolFn:
        @wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> dict:
            try:
                result = await fn(*args, **kwargs)
            except Exception:
                result = fail("ERROR")
            if not isinstance(result, dict):
                result = fail("ERROR")
            record_run(name, kwargs, result)
            return result

        wrapper.__name__ = name
        return wrapper

    return deco
