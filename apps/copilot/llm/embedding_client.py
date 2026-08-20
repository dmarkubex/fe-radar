"""Qwen embeddings client. Never uses SERVICE_TOKEN_WORKER or /chat/completions."""

from __future__ import annotations

import os

import httpx

from config import get_settings

EMBED_TIMEOUT_SEC = 8.0


class EmbedError(Exception):
    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


def _base_url() -> str:
    return (os.environ.get("QWEN_EMBEDDING_BASE_URL") or get_settings().qwen_base_url).rstrip("/")


def _api_key() -> str:
    return (
        os.environ.get("QWEN_EMBEDDING_API_KEY")
        or os.environ.get("QWEN_API_KEY")
        or "local-qwen"
    )


async def embed_query(text: str) -> list[float]:
    url = f"{_base_url()}/embeddings"
    headers = {"Authorization": f"Bearer {_api_key()}"}
    payload: dict[str, object] = {"input": text, "encoding_format": "float"}
    model = os.environ.get("QWEN_EMBEDDING_MODEL")
    if model:
        payload["model"] = model
    try:
        async with httpx.AsyncClient(timeout=EMBED_TIMEOUT_SEC) as client:
            response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()
        embedding = data["data"][0]["embedding"]
    except httpx.TimeoutException as exc:
        raise EmbedError("EMBED_TIMEOUT") from exc
    except EmbedError:
        raise
    except Exception as exc:
        raise EmbedError("EMBED_UNAVAILABLE") from exc
    if not isinstance(embedding, list):
        raise EmbedError("EMBED_UNAVAILABLE")
    return embedding
