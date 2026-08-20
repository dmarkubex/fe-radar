from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.fakes import INTERNAL_SECRET

_TMP = Path(tempfile.mkdtemp(prefix="copilot-06a-"))
(_TMP / "db_url").write_text(
    "postgresql://copilot_app:test@127.0.0.1:1/fe_radar\n",
    encoding="utf-8",
)
(_TMP / "internal").write_text("test-internal-secret\n", encoding="utf-8")
(_TMP / "worker").write_text("test-worker-token\n", encoding="utf-8")

os.environ["COPILOT_DB_URL_FILE"] = str(_TMP / "db_url")
os.environ["COPILOT_INTERNAL_SECRET_FILE"] = str(_TMP / "internal")
os.environ["SERVICE_TOKEN_WORKER_FILE"] = str(_TMP / "worker")
os.environ["QWEN_BASE_URL"] = "http://127.0.0.1:9/v1"


@pytest.fixture
def internal_secret() -> str:
    return INTERNAL_SECRET


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    import main as main_mod

    async def _no_pool(_settings: object) -> None:
        return None

    monkeypatch.setattr(main_mod, "maybe_open_pool", _no_pool)
    with TestClient(main_mod.app) as test_client:
        yield test_client
