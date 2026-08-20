"""get_daily_report from daily_reports."""

from __future__ import annotations

from tools.registry import fail, get_conn, iso, ok_rows, row_dict, tracked


@tracked("get_daily_report")
async def get_daily_report(date: str) -> dict:
    params = {"d": date}
    sql = "SELECT date, sections FROM daily_reports WHERE date=%(d)s::date"
    cursor = await get_conn().execute(sql, params)
    row = await cursor.fetchone()
    if row is None:
        return fail("NOT_FOUND")
    data = row_dict(cursor, row)
    return ok_rows([{"date": iso(data.get("date")), "sections": data.get("sections")}])
