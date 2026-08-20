"""get_item against copilot.visible_items."""

from __future__ import annotations

from tools.registry import fail, get_conn, iso, ok_rows, row_dict, tracked


@tracked("get_item")
async def get_item(itemId: int) -> dict:
    params = {"iid": itemId}
    sql = (
        "SELECT v.id, v.title, v.summary_zh, v.scored_at, v.source_name "
        "FROM copilot.visible_items v "
        "WHERE v.id = %(iid)s"
    )
    conn = get_conn()
    cursor = await conn.execute(sql, params)
    row = await cursor.fetchone()
    if row is None:
        return fail("NOT_VISIBLE")
    data = row_dict(cursor, row)
    ent_sql = (
        "SELECT e.id, e.canonical_name, e.type "
        "FROM item_entities ie "
        "JOIN entities e ON e.id = ie.entity_id "
        "WHERE ie.item_id = %(iid)s "
        "ORDER BY e.id"
    )
    ent_cursor = await conn.execute(ent_sql, params)
    entities = []
    for ent in await ent_cursor.fetchall():
        ed = row_dict(ent_cursor, ent)
        entities.append(
            {
                "entityId": ed.get("id"),
                "canonicalName": ed.get("canonical_name"),
                "type": ed.get("type"),
            }
        )
    return ok_rows(
        [
            {
                "id": data.get("id"),
                "title": data.get("title"),
                "summaryZh": data.get("summary_zh"),
                "scoredAt": iso(data.get("scored_at")),
                "sourceName": data.get("source_name"),
                "entities": entities,
            }
        ]
    )
