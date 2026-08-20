"""search_items + semantic_search against copilot.visible_items."""

from __future__ import annotations

from psycopg.errors import UndefinedObject

from llm.embedding_client import EmbedError, embed_query
from tools.registry import (
    clamp_days,
    clamp_limit,
    fail,
    get_conn,
    iso,
    ok_rows,
    row_dict,
    tracked,
)

_ITEM_COLS = "v.id, v.title, v.summary_zh, v.quality_score, v.scored_at, v.source_name"
_BASE_WHERE = (
    "v.scored_at >= now() - (%(days)s || ' days')::interval "
    "AND (%(entity_id)s IS NULL OR EXISTS ("
    "SELECT 1 FROM item_entities ie WHERE ie.item_id=v.id AND ie.entity_id=%(entity_id)s"
    ")) "
    "AND (%(category)s IS NULL OR v.category = %(category)s) "
    "AND (%(circle)s IS NULL OR v.top_circle = %(circle)s) "
    "AND (%(min_score)s IS NULL OR v.quality_score >= %(min_score)s)"
)
_FTS = (
    "to_tsvector('zhparser', coalesce(v.title,'') || ' ' || coalesce(v.content,'')) "
    "@@ plainto_tsquery('zhparser',%(q)s)"
)
_ILIKE = (
    "(v.title ILIKE '%%' || %(q)s || '%%' "
    "OR v.content ILIKE '%%' || %(q)s || '%%' "
    "OR v.summary_zh ILIKE '%%' || %(q)s || '%%')"
)


def _item_row(data: dict) -> dict:
    return {
        "id": data.get("id"),
        "title": data.get("title"),
        "summaryZh": data.get("summary_zh"),
        "qualityScore": data.get("quality_score"),
        "scoredAt": iso(data.get("scored_at")),
        "sourceName": data.get("source_name"),
    }


def _search_params(
    q: str | None,
    entity_id: int | None,
    category: str | None,
    circle: str | None,
    days: int | None,
    min_score: int | None,
    limit: int | None,
) -> dict:
    return {
        "q": q,
        "entity_id": entity_id,
        "category": category,
        "circle": circle,
        "days": clamp_days(days),
        "min_score": min_score,
        "limit": clamp_limit(limit),
    }


@tracked("search_items")
async def search_items(
    q: str | None = None,
    entityId: int | None = None,
    category: str | None = None,
    circle: str | None = None,
    days: int | None = None,
    minScore: int | None = None,
    limit: int | None = None,
) -> dict:
    params = _search_params(q, entityId, category, circle, days, minScore, limit)
    query = (q or "").strip() or None
    params["q"] = query
    where = _BASE_WHERE
    if query:
        where = f"{where} AND {_FTS}"
    sql = (
        f"SELECT {_ITEM_COLS} FROM copilot.visible_items v "
        f"WHERE {where} ORDER BY v.scored_at DESC LIMIT %(limit)s"
    )
    conn = get_conn()
    if query:
        await conn.execute("SAVEPOINT fts")
        try:
            cursor = await conn.execute(sql, params)
            rows = await cursor.fetchall()
        except UndefinedObject as exc:
            if getattr(exc, "sqlstate", None) != "42704":
                raise
            await conn.execute("ROLLBACK TO SAVEPOINT fts")
            ilike_sql = (
                f"SELECT {_ITEM_COLS} FROM copilot.visible_items v "
                f"WHERE {_BASE_WHERE} AND {_ILIKE} "
                f"ORDER BY v.scored_at DESC LIMIT %(limit)s"
            )
            cursor = await conn.execute(ilike_sql, params)
            rows = await cursor.fetchall()
        else:
            await conn.execute("RELEASE SAVEPOINT fts")
    else:
        cursor = await conn.execute(sql, params)
        rows = await cursor.fetchall()
    return ok_rows([_item_row(row_dict(cursor, row)) for row in rows])


@tracked("semantic_search")
async def semantic_search(
    q: str,
    days: int | None = None,
    limit: int | None = None,
) -> dict:
    try:
        vec = await embed_query(q)
    except EmbedError as exc:
        return fail(exc.reason)
    if len(vec) != 1024:
        return fail("EMBED_DIM")
    params = {
        "vec": "[" + ",".join(str(x) for x in vec) + "]",
        "days": clamp_days(days),
        "limit": clamp_limit(limit),
    }
    sql = (
        f"SELECT {_ITEM_COLS} FROM copilot.visible_items v "
        "WHERE v.embedding IS NOT NULL "
        "AND v.scored_at >= now() - (%(days)s || ' days')::interval "
        "ORDER BY v.embedding <=> %(vec)s::vector "
        "LIMIT %(limit)s"
    )
    try:
        cursor = await get_conn().execute(sql, params)
        rows = await cursor.fetchall()
    except Exception as exc:
        sqlstate = getattr(exc, "sqlstate", None)
        message = str(exc).lower()
        if sqlstate in {"42704", "42883", "42804"} or "vector" in message:
            return fail("EMBED_UNAVAILABLE")
        raise
    return ok_rows([_item_row(row_dict(cursor, row)) for row in rows])
