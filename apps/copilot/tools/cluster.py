"""get_cluster: membership via cluster_items, members via visible_items."""

from __future__ import annotations

from tools.registry import fail, get_conn, iso, ok_rows, row_dict, tracked


@tracked("get_cluster")
async def get_cluster(clusterId: int | None = None, itemId: int | None = None) -> dict:
    if clusterId is None and itemId is None:
        return fail("BAD_ARGS")
    conn = get_conn()
    cid = clusterId
    iid = itemId
    if cid is not None and iid is not None:
        cursor = await conn.execute(
            "SELECT 1 FROM cluster_items WHERE cluster_id=%(cid)s AND item_id=%(iid)s",
            {"cid": cid, "iid": iid},
        )
        if await cursor.fetchone() is None:
            return fail("CONFLICT")
    elif iid is not None:
        cursor = await conn.execute(
            "SELECT cluster_id FROM cluster_items WHERE item_id=%(iid)s "
            "ORDER BY cluster_id LIMIT 1",
            {"iid": iid},
        )
        row = await cursor.fetchone()
        if row is None:
            return fail("NOT_FOUND")
        data = row_dict(cursor, row)
        cid = data.get("cluster_id")
    else:
        cursor = await conn.execute(
            "SELECT id FROM clusters WHERE id=%(cid)s",
            {"cid": cid},
        )
        if await cursor.fetchone() is None:
            return fail("NOT_FOUND")
    members_sql = (
        "SELECT v.id, v.title, v.summary_zh, v.scored_at, v.source_name "
        "FROM copilot.visible_items v "
        "JOIN cluster_items ci ON ci.item_id=v.id "
        "WHERE ci.cluster_id=%(cid)s "
        "ORDER BY v.id"
    )
    cursor = await conn.execute(members_sql, {"cid": cid})
    rows = []
    for row in await cursor.fetchall():
        data = row_dict(cursor, row)
        rows.append(
            {
                "id": data.get("id"),
                "title": data.get("title"),
                "summaryZh": data.get("summary_zh"),
                "scoredAt": iso(data.get("scored_at")),
                "sourceName": data.get("source_name"),
            }
        )
    return ok_rows(rows)
