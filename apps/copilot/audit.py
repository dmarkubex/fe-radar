"""Read-only audit rows from toolRuns (INSERT is 06c)."""

from __future__ import annotations

import json
from typing import Any

from ground_numbers import is_success_evidence

_PREVIEW_LEN = 500


def _preview(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=False, default=str)
    return text[:_PREVIEW_LEN]


def coverage_from_tool_runs(runs: list) -> str:
    return "ok" if any(is_success_evidence(run) for run in runs) else "none"


def rows_from_tool_runs(runs: list) -> list[dict]:
    out: list[dict] = []
    for run in runs:
        result = run.get("result") if isinstance(run.get("result"), dict) else {}
        rows = result.get("rows") if isinstance(result, dict) else None
        count = len(rows) if isinstance(rows, list) else 0
        out.append(
            {
                "tool_name": run.get("name"),
                "args_preview": _preview(run.get("args") or {}),
                "result_preview": _preview(result),
                "result_row_count": count,
            }
        )
    return out
