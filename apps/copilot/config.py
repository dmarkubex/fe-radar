"""Startup fail-fast: three Docker secret files + QWEN_BASE_URL."""

from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from psycopg_pool import AsyncConnectionPool

logger = logging.getLogger(__name__)

_settings: Settings | None = None


@dataclass(frozen=True)
class Settings:
    copilot_db_url: str
    copilot_internal_secret: str
    service_token_worker: str
    qwen_base_url: str
    worker_internal_url: str


def _fail(env_name: str) -> None:
    logger.error("missing env %s", env_name)
    raise SystemExit(1)


def _read_secret_file(file_env: str, value_env: str) -> str:
    path = (os.environ.get(file_env) or "").strip()
    if not path:
        _fail(file_env)
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError:
        _fail(file_env)
    value = raw.strip()
    if not value:
        _fail(value_env)
    return value


def load_settings() -> Settings:
    db_url = _read_secret_file("COPILOT_DB_URL_FILE", "COPILOT_DB_URL")
    internal = _read_secret_file("COPILOT_INTERNAL_SECRET_FILE", "COPILOT_INTERNAL_SECRET")
    worker = _read_secret_file("SERVICE_TOKEN_WORKER_FILE", "SERVICE_TOKEN_WORKER")
    qwen = (os.environ.get("QWEN_BASE_URL") or "").strip()
    if not qwen:
        _fail("QWEN_BASE_URL")
    worker_url = (os.environ.get("WORKER_INTERNAL_URL") or "http://worker:8071").strip().rstrip("/")
    if not worker_url:
        worker_url = "http://worker:8071"
    return Settings(
        copilot_db_url=db_url,
        copilot_internal_secret=internal,
        service_token_worker=worker,
        qwen_base_url=qwen,
        worker_internal_url=worker_url,
    )


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = load_settings()
    return _settings


def reset_settings() -> None:
    global _settings
    _settings = None


def make_pool(settings: Settings) -> AsyncConnectionPool:
    return AsyncConnectionPool(
        conninfo=settings.copilot_db_url,
        min_size=1,
        max_size=8,
        timeout=5,
        open=False,
    )
