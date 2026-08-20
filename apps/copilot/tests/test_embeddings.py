from __future__ import annotations

import httpx
import pytest
from llm.embedding_client import EmbedError, embed_query
from tests.fakes import WORKER_TOKEN


class _Resp:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


async def test_embed_uses_local_qwen_and_embeddings_path(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}

    class _Client:
        def __init__(self, *args, **kwargs):
            captured["timeout"] = kwargs.get("timeout")

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return None

        async def post(self, url, json=None, headers=None):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return _Resp({"data": [{"embedding": [0.1] * 1024}]})

    monkeypatch.delenv("QWEN_EMBEDDING_API_KEY", raising=False)
    monkeypatch.delenv("QWEN_API_KEY", raising=False)
    monkeypatch.delenv("QWEN_EMBEDDING_BASE_URL", raising=False)
    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    vec = await embed_query("铜价")
    assert len(vec) == 1024
    assert captured["timeout"] == 8.0
    assert captured["url"] == "http://127.0.0.1:9/v1/embeddings"
    assert "/chat/completions" not in captured["url"]
    assert captured["headers"]["Authorization"] == "Bearer local-qwen"
    assert WORKER_TOKEN not in captured["headers"]["Authorization"]
    assert "test-worker-token" not in str(captured)


async def test_embed_timeout_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Client:
        def __init__(self, *args, **kwargs):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return None

        async def post(self, url, json=None, headers=None):
            raise httpx.TimeoutException("slow")

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    with pytest.raises(EmbedError) as exc:
        await embed_query("x")
    assert exc.value.reason == "EMBED_TIMEOUT"


async def test_embed_prefers_embedding_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}

    class _Client:
        def __init__(self, *args, **kwargs):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return None

        async def post(self, url, json=None, headers=None):
            captured["headers"] = headers
            captured["url"] = url
            return _Resp({"data": [{"embedding": [1.0] * 1024}]})

    monkeypatch.setenv("QWEN_EMBEDDING_BASE_URL", "http://embed.local/v1")
    monkeypatch.setenv("QWEN_API_KEY", "fallback-key")
    monkeypatch.setenv("QWEN_EMBEDDING_API_KEY", "embed-key")
    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    await embed_query("x")
    assert captured["url"] == "http://embed.local/v1/embeddings"
    assert captured["headers"]["Authorization"] == "Bearer embed-key"
    assert "test-worker-token" not in captured["headers"]["Authorization"]
