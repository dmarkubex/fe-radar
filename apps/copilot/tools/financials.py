"""get_entity_financials: exact name, DISTINCT ON (metric), value as str(Decimal)."""

from __future__ import annotations

from decimal import Decimal

from tools.registry import fail, get_conn, iso, ok_rows, row_dict, tracked


def _value_str(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, str):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    return str(value)


@tracked("get_entity_financials")
async def get_entity_financials(
    entityId: int | None = None,
    canonicalName: str | None = None,
) -> dict:
    if entityId is None and not canonicalName:
        return fail("BAD_ARGS")
    conn = get_conn()
    if entityId is not None:
        cursor = await conn.execute(
            "SELECT id, canonical_name, type FROM entities WHERE id = %(eid)s",
            {"eid": entityId},
        )
        rows = await cursor.fetchall()
    else:
        cursor = await conn.execute(
            "SELECT id, canonical_name, type FROM entities "
            "WHERE canonical_name = %(name)s ORDER BY id",
            {"name": canonicalName},
        )
        rows = await cursor.fetchall()
    if not rows:
        return fail("NOT_FOUND")
    if len(rows) > 1:
        candidates = []
        for row in rows:
            data = row_dict(cursor, row)
            candidates.append(
                {
                    "entityId": data.get("id"),
                    "type": data.get("type"),
                    "canonicalName": data.get("canonical_name"),
                }
            )
        return fail("AMBIGUOUS", candidates=candidates)
    entity = row_dict(cursor, rows[0])
    eid = entity.get("id")
    fin_sql = (
        "SELECT * FROM ("
        "SELECT DISTINCT ON (metric) metric, value, period, observed_at, fetched_at "
        "FROM entity_financials "
        "WHERE entity_id = %(eid)s "
        "ORDER BY metric, observed_at DESC NULLS LAST, fetched_at DESC, id DESC"
        ") t LIMIT 40"
    )
    fin_cursor = await conn.execute(fin_sql, {"eid": eid})
    out = []
    for row in await fin_cursor.fetchall():
        data = row_dict(fin_cursor, row)
        out.append(
            {
                "entityId": eid,
                "canonicalName": entity.get("canonical_name"),
                "type": entity.get("type"),
                "metric": data.get("metric"),
                "value": _value_str(data.get("value")),
                "period": data.get("period"),
                "observedAt": iso(data.get("observed_at")),
                "fetchedAt": iso(data.get("fetched_at")),
            }
        )
    return ok_rows(out)
