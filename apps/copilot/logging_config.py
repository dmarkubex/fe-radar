"""NFR-309: single JSON stdout handler for root / uvicorn / agentscope."""

from __future__ import annotations

import json
import logging
import logging.config
import sys
from typing import Any

_REDACT_KEYS = frozenset({"webhook_url", "sign_secret", "authorization", "password"})

_RESERVED = frozenset(
    {
        "name",
        "msg",
        "args",
        "created",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "module",
        "msecs",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "thread",
        "threadName",
        "exc_info",
        "exc_text",
        "stack_info",
        "message",
        "asctime",
        "taskName",
        "correlationId",
    }
)


def _should_redact(key: object) -> bool:
    return isinstance(key, str) and key.lower() in _REDACT_KEYS


def _redact_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            k: ("***" if _should_redact(k) else _redact_value(v)) for k, v in value.items()
        }
    if isinstance(value, list):
        return [_redact_value(v) for v in value]
    if isinstance(value, tuple):
        return tuple(_redact_value(v) for v in value)
    return value


class RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        for key, value in list(record.__dict__.items()):
            if _should_redact(key):
                setattr(record, key, "***")
            elif key not in _RESERVED and isinstance(value, (dict, list, tuple)):
                setattr(record, key, _redact_value(value))
        if isinstance(record.msg, dict):
            record.msg = _redact_value(record.msg)
        if isinstance(record.args, dict):
            record.args = _redact_value(record.args)
        elif isinstance(record.args, tuple):
            record.args = tuple(_redact_value(v) for v in record.args)
        return True


class DropUvicornBannerFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True
        return "Uvicorn running" not in message


class CurrentStdoutHandler(logging.StreamHandler):
    """Resolve sys.stdout at emit time so pytest capsys can capture JSON lines."""

    def __init__(self) -> None:
        super().__init__(stream=sys.stdout)

    def emit(self, record: logging.LogRecord) -> None:
        self.stream = sys.stdout
        super().emit(record)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        msg = record.getMessage()
        payload: dict[str, Any] = {
            "level": record.levelname.lower(),
            "time": int(record.created * 1000),
            "msg": msg if isinstance(msg, str) else str(msg),
        }
        correlation_id = getattr(record, "correlationId", None)
        if correlation_id is not None:
            payload["correlationId"] = correlation_id
        for key, value in record.__dict__.items():
            if key in _RESERVED or key in payload:
                continue
            payload[key] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging() -> None:
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {
                "redact": {"()": RedactFilter},
                "drop_uvicorn_banner": {"()": DropUvicornBannerFilter},
            },
            "formatters": {
                "json": {"()": JsonFormatter},
            },
            "handlers": {
                "stdout": {
                    "()": CurrentStdoutHandler,
                    "formatter": "json",
                    "filters": ["redact", "drop_uvicorn_banner"],
                }
            },
            "root": {
                "level": "INFO",
                "handlers": ["stdout"],
            },
            "loggers": {
                "uvicorn": {
                    "level": "INFO",
                    "handlers": ["stdout"],
                    "propagate": False,
                },
                "uvicorn.access": {
                    "level": "INFO",
                    "handlers": ["stdout"],
                    "propagate": False,
                },
                "uvicorn.error": {
                    "level": "INFO",
                    "handlers": ["stdout"],
                    "propagate": False,
                },
                "agentscope": {
                    "level": "INFO",
                    "handlers": ["stdout"],
                    "propagate": False,
                },
            },
        }
    )
