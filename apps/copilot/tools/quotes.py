"""get_quotes_series: CU/LC closes + changeRatio original / changePct percent."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from tools.registry import clamp_days, fail, get_conn, iso, ok_rows, row_dict, tracked

_SYMBOL_METRIC = {"CU": "cu_main_close", "LC": "lc_main_close"}


def _raw_str(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return str(value)
    return str(value)


def _change_pct(ratio: object) -> str | None:
    if ratio is None:
        return None
    raw = ratio if isinstance(ratio, Decimal) else Decimal(str(ratio))
    try:
        pct = (raw * Decimal(100)).normalize()
    except InvalidOperation:
        return None
    text = format(pct, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return f"{text}%"


@tracked("get_quotes_series")
async def get_quotes_series(symbol: str, days: int | None = None) -> dict:
    metric = _SYMBOL_METRIC.get(symbol)
    if metric is None:
        return fail("BAD_ARGS")
    params = {"metric": metric, "days": clamp_days(days)}
    sql = (
        "SELECT c.observed_at, c.value, p.value AS change_value, c.metric_key "
        "FROM commodity_quotes c "
        "LEFT JOIN commodity_quotes p ON p.metric_key = CASE c.metric_key "
        "WHEN 'cu_main_close' THEN 'cu_change_pct' "
        "WHEN 'lc_main_close' THEN 'lc_change_pct' END "
        "AND p.observed_at = c.observed_at "
        "WHERE c.metric_key=%(metric)s "
        "AND c.observed_at >= now() - (%(days)s || ' days')::interval "
        "ORDER BY c.observed_at"
    )
    cursor = await get_conn().execute(sql, params)
    rows = []
    for row in await cursor.fetchall():
        data = row_dict(cursor, row)
        change = data.get("change_value")
        rows.append(
            {
                "observedAt": iso(data.get("observed_at")),
                "value": _raw_str(data.get("value")),
                "changeRatio": _raw_str(change),
                "changePct": _change_pct(change),
                "metricKey": data.get("metric_key"),
            }
        )
    return ok_rows(rows)
