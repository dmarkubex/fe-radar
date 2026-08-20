from __future__ import annotations

from contextlib import contextmanager
from decimal import Decimal

import httpx
import pytest
from citations import citations_from_tool_runs
from psycopg.errors import UndefinedObject
from tests.fakes import FakeConn
from tools.cluster import get_cluster
from tools.financials import get_entity_financials
from tools.fulltext import fetch_fulltext
from tools.item import get_item
from tools.quotes import get_quotes_series
from tools.registry import dbConnVar, toolRunsVar
from tools.reports import get_daily_report
from tools.timeline import search_items, semantic_search


@contextmanager
def tool_ctx(conn: FakeConn):
    runs_token = toolRunsVar.set([])
    db_token = dbConnVar.set(conn)
    try:
        yield
    finally:
        toolRunsVar.reset(runs_token)
        dbConnVar.reset(db_token)


def _item_cols() -> list[str]:
    return ["id", "title", "summary_zh", "quality_score", "scored_at", "source_name"]


async def test_search_items_binds_named_params_and_visible_items() -> None:
    conn = FakeConn()
    conn.enqueue(rows=[(1, "铜", "s", 80, None, "SMM")], colnames=_item_cols())
    with tool_ctx(conn):
        result = await search_items(q="铜", entityId=9, days=30, limit=10)
        runs = list(toolRunsVar.get() or [])
    assert result["ok"] is True
    sql, params = [call for call in conn.calls if "SELECT" in call[0]][0]
    assert "FROM copilot.visible_items v" in sql
    assert "COPILOT" + "_VISIBLE" not in sql
    assert "$" + "1" not in sql
    assert "%(q)s" in sql
    assert "%(entity_id)s" in sql
    assert params == {
        "q": "铜",
        "entity_id": 9,
        "category": None,
        "circle": None,
        "days": 30,
        "min_score": None,
        "limit": 10,
    }
    assert runs[0]["name"] == "search_items"


async def test_search_items_fts_undefined_falls_back_to_ilike() -> None:
    conn = FakeConn()
    conn.enqueue(exc=UndefinedObject("text search configuration zhparser does not exist"))
    conn.enqueue(rows=[(2, "锂", None, 70, None, "x")], colnames=_item_cols())
    with tool_ctx(conn):
        result = await search_items(q="锂")
    assert result["ok"] is True
    assert result["rows"][0]["id"] == 2
    commands = [sql for sql, _ in conn.calls]
    assert any(sql.startswith("SAVEPOINT") for sql in commands)
    assert any("ROLLBACK TO SAVEPOINT" in sql for sql in commands)
    assert any("ILIKE" in sql for sql in commands)


async def test_search_items_clamps_days_and_limit() -> None:
    conn = FakeConn()
    conn.enqueue(rows=[], colnames=_item_cols())
    with tool_ctx(conn):
        await search_items(q="x", days=200, limit=99)
    params = [call[1] for call in conn.calls if call[1] and "q" in call[1]][0]
    assert params["days"] == 90
    assert params["limit"] == 20


async def test_semantic_search_embed_dim() -> None:
    async def _short(_text: str) -> list[float]:
        return [0.1, 0.2]

    import tools.timeline as timeline

    timeline.embed_query = _short  # type: ignore[assignment]
    try:
        with tool_ctx(FakeConn()):
            result = await semantic_search(q="铜")
        assert result == {"ok": False, "reason": "EMBED_DIM"}
    finally:
        from llm.embedding_client import embed_query as real

        timeline.embed_query = real  # type: ignore[assignment]


async def test_semantic_search_vector_unavailable() -> None:
    async def _ok(_text: str) -> list[float]:
        return [0.0] * 1024

    import tools.timeline as timeline

    timeline.embed_query = _ok  # type: ignore[assignment]
    conn = FakeConn()
    conn.enqueue(exc=UndefinedObject('type "vector" does not exist'))
    try:
        with tool_ctx(conn):
            result = await semantic_search(q="铜", days=7, limit=5)
        assert result == {"ok": False, "reason": "EMBED_UNAVAILABLE"}
        sql, params = conn.calls[0]
        assert "FROM copilot.visible_items v" in sql
        assert "%(vec)s::vector" in sql
        assert params["days"] == 7
        assert params["limit"] == 5
        assert params["vec"].startswith("[")
    finally:
        from llm.embedding_client import embed_query as real

        timeline.embed_query = real  # type: ignore[assignment]


async def test_get_item_binds_iid() -> None:
    conn = FakeConn()
    conn.enqueue(
        rows=[(3, "标题", "摘要", None, "来源")],
        colnames=["id", "title", "summary_zh", "scored_at", "source_name"],
    )
    conn.enqueue(rows=[], colnames=["id", "canonical_name", "type"])
    with tool_ctx(conn):
        result = await get_item(itemId=3)
    assert result["ok"] is True
    assert result["rows"][0]["title"] == "标题"
    sql, params = conn.calls[0]
    assert "FROM copilot.visible_items v" in sql
    assert params == {"iid": 3}


async def test_get_item_not_visible() -> None:
    conn = FakeConn()
    conn.enqueue(rows=[], colnames=["id", "title", "summary_zh", "scored_at", "source_name"])
    with tool_ctx(conn):
        result = await get_item(itemId=99)
    assert result == {"ok": False, "reason": "NOT_VISIBLE"}


async def test_get_cluster_bad_args_and_conflict() -> None:
    with tool_ctx(FakeConn()):
        assert await get_cluster() == {"ok": False, "reason": "BAD_ARGS"}
    conn = FakeConn()
    conn.enqueue(rows=[], colnames=["?column?"])
    with tool_ctx(conn):
        result = await get_cluster(clusterId=1, itemId=2)
    assert result == {"ok": False, "reason": "CONFLICT"}
    assert conn.calls[0][1] == {"cid": 1, "iid": 2}


async def test_get_cluster_members_use_visible_items() -> None:
    conn = FakeConn()
    conn.enqueue(rows=[(8,)], colnames=["id"])
    conn.enqueue(
        rows=[(4, "可见", None, None, "src")],
        colnames=["id", "title", "summary_zh", "scored_at", "source_name"],
    )
    with tool_ctx(conn):
        result = await get_cluster(clusterId=8)
    assert result["ok"] is True
    members_sql, params = conn.calls[1]
    assert "FROM copilot.visible_items v" in members_sql
    assert "JOIN cluster_items ci ON ci.item_id=v.id" in members_sql
    assert params == {"cid": 8}
    assert result["rows"][0]["id"] == 4


async def test_fetch_fulltext_posts_worker_with_bearer(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}

    class _Resp:
        def json(self) -> dict:
            return {
                "ok": True,
                "itemId": 42,
                "content": "正文 80000",
                "truncated": False,
                "source": "stored",
                "title": "铜价观察",
                "summaryZh": "摘要",
                "scoredAt": "2026-08-19T00:00:00+08:00",
                "sourceName": "SMM",
            }

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
            return _Resp()

    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://worker.test:8071")
    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    with tool_ctx(FakeConn()):
        result = await fetch_fulltext(itemId=42)
        cards = citations_from_tool_runs(toolRunsVar.get() or [])
    assert captured["timeout"] == 25.0
    assert captured["url"] == "http://worker.test:8071/internal/fulltext"
    assert captured["json"] == {"itemId": 42}
    assert captured["headers"]["Authorization"] == "Bearer test-worker-token"
    assert result["ok"] is True
    assert cards[0]["kind"] == "item"
    assert cards[0]["itemId"] == 42
    assert cards[0]["title"] == "铜价观察"
    assert cards[0]["sourceName"] == "SMM"


async def test_get_daily_report_binds_date() -> None:
    conn = FakeConn()
    conn.enqueue(rows=[("2026-08-19", {"a": 1})], colnames=["date", "sections"])
    with tool_ctx(conn):
        result = await get_daily_report(date="2026-08-19")
    assert result["ok"] is True
    sql, params = conn.calls[0]
    assert "%(d)s::date" in sql
    assert params == {"d": "2026-08-19"}


async def test_get_entity_financials_ambiguous_no_numbers() -> None:
    conn = FakeConn()
    conn.enqueue(
        rows=[(1, "远东", "company"), (2, "远东", "brand")],
        colnames=["id", "canonical_name", "type"],
    )
    with tool_ctx(conn):
        result = await get_entity_financials(canonicalName="远东")
    assert result["ok"] is False
    assert result["reason"] == "AMBIGUOUS"
    assert "rows" not in result
    sql, params = conn.calls[0]
    assert "canonical_name = %(name)s" in sql
    assert params == {"name": "远东"}
    assert len(conn.calls) == 1


async def test_get_entity_financials_distinct_on_and_decimal_str() -> None:
    conn = FakeConn()
    conn.enqueue(rows=[(7, "远东控股", "company")], colnames=["id", "canonical_name", "type"])
    conn.enqueue(
        rows=[("roe", Decimal("12.3400"), "2024", None, None)],
        colnames=["metric", "value", "period", "observed_at", "fetched_at"],
    )
    with tool_ctx(conn):
        result = await get_entity_financials(entityId=7)
    assert result["ok"] is True
    assert result["rows"][0]["value"] == "12.3400"
    assert result["rows"][0]["entityId"] == 7
    fin_sql, params = conn.calls[1]
    assert "DISTINCT ON (metric)" in fin_sql
    assert "ORDER BY metric, observed_at DESC NULLS LAST, fetched_at DESC, id DESC" in fin_sql
    assert params == {"eid": 7}


async def test_get_quotes_series_cu_change_pct() -> None:
    conn = FakeConn()
    conn.enqueue(
        rows=[(None, Decimal("80000.0000"), Decimal("0.0067"), "cu_main_close")],
        colnames=["observed_at", "value", "change_value", "metric_key"],
    )
    with tool_ctx(conn):
        result = await get_quotes_series(symbol="CU", days=14)
    assert result["ok"] is True
    row = result["rows"][0]
    assert row["changeRatio"] == "0.0067"
    assert row["changePct"] == "0.67%"
    assert row["metricKey"] == "cu_main_close"
    sql, params = conn.calls[0]
    assert params == {"metric": "cu_main_close", "days": 14}
    assert "%(metric)s" in sql
    assert "%(days)s" in sql
