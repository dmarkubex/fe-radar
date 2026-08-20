"""Build citation cards from toolRuns only (design L1041–1046)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

_ITEM_TOOLS = frozenset(
    {"search_items", "semantic_search", "get_item", "get_cluster", "fetch_fulltext"}
)
_MAX_ITEM_CARDS = 8


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _rows_of(result: dict) -> list:
    rows = result.get("rows")
    if isinstance(rows, list) and rows:
        return rows
    return [result]


def _item_id(row: dict) -> int | None:
    for key in ("itemId", "id"):
        value = row.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)
    return None


def _item_card(row: dict) -> dict | None:
    item_id = _item_id(row)
    title = row.get("title")
    if item_id is None or not isinstance(title, str) or not title:
        return None
    source_name = row.get("sourceName")
    if source_name is None:
        source_name = row.get("source_name")
    if not isinstance(source_name, str) or not source_name:
        source_name = ""
    summary = row.get("summaryZh")
    if summary is None:
        summary = row.get("summary_zh")
    scored = row.get("scoredAt")
    if scored is None:
        scored = row.get("scored_at")
    return {
        "kind": "item",
        "itemId": item_id,
        "title": title,
        "summaryZh": summary if isinstance(summary, str) or summary is None else str(summary),
        "scoredAt": _iso(scored),
        "sourceName": source_name,
    }


def _report_card(row: dict) -> dict | None:
    value = row.get("date")
    if value is None:
        return None
    if isinstance(value, date):
        return {"kind": "report", "date": value.isoformat()}
    text = str(value)
    return {"kind": "report", "date": text[:10]} if text else None


def _financials_card(row: dict) -> dict | None:
    entity_id = row.get("entityId", row.get("entity_id"))
    name = row.get("canonicalName", row.get("canonical_name"))
    typ = row.get("type")
    if not isinstance(entity_id, int) or not isinstance(name, str) or not isinstance(typ, str):
        return None
    return {"kind": "financials", "entityId": entity_id, "canonicalName": name, "type": typ}


def _quotes_card(row: dict, args: dict) -> dict | None:
    symbol = args.get("symbol")
    metric = row.get("metricKey", row.get("metric_key"))
    if symbol not in ("CU", "LC") or not isinstance(metric, str):
        return None
    return {"kind": "quotes", "symbol": symbol, "metricKey": metric}


def item_ids_from_tool_runs(runs: list) -> list[int]:
    """成功 toolRuns 里的全部 item id，不截断（NFR-304 终局复核用）。"""
    ids: list[int] = []
    seen: set[int] = set()
    for run in runs:
        if not run.get("ok"):
            continue
        result = run.get("result")
        if not isinstance(result, dict) or result.get("ok") is not True:
            continue
        if run.get("name") not in _ITEM_TOOLS:
            continue
        for row in _rows_of(result):
            if not isinstance(row, dict):
                continue
            item_id = _item_id(row)
            if item_id is None or item_id in seen:
                continue
            seen.add(item_id)
            ids.append(item_id)
    return ids


def citations_from_tool_runs(runs: list) -> list:
    items: list[dict] = []
    seen_items: set[int] = set()
    reports: list[dict] = []
    financials: list[dict] = []
    quotes: list[dict] = []

    for run in runs:
        if not run.get("ok"):
            continue
        result = run.get("result")
        if not isinstance(result, dict) or result.get("ok") is not True:
            continue
        name = run.get("name")
        args = run.get("args") if isinstance(run.get("args"), dict) else {}
        if name in _ITEM_TOOLS:
            for row in _rows_of(result):
                if not isinstance(row, dict):
                    continue
                card = _item_card(row)
                if card is None or card["itemId"] in seen_items:
                    continue
                seen_items.add(card["itemId"])
                items.append(card)
                if len(items) >= _MAX_ITEM_CARDS:
                    break
        elif name == "get_daily_report":
            for row in _rows_of(result):
                if isinstance(row, dict):
                    card = _report_card(row)
                    if card:
                        reports.append(card)
        elif name == "get_entity_financials":
            for row in _rows_of(result):
                if isinstance(row, dict):
                    card = _financials_card(row)
                    if card:
                        financials.append(card)
                        break
        elif name == "get_quotes_series":
            for row in _rows_of(result):
                if isinstance(row, dict):
                    card = _quotes_card(row, args)
                    if card:
                        quotes.append(card)
                        break

    items = items[:_MAX_ITEM_CARDS]
    if items:
        return items
    return reports + financials + quotes
