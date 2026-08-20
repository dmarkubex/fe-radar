from __future__ import annotations

from ground_numbers import (
    REPLACE,
    allowed_from_tool_runs,
    canon,
    fold_num,
    ground_answer,
    ground_numbers,
)


def _ok(name: str, result: dict, args: dict | None = None) -> dict:
    return {"name": name, "args": args or {}, "result": result, "ok": True}


def _fail(name: str, result: dict, args: dict | None = None) -> dict:
    return {"name": name, "args": args or {}, "result": result, "ok": False}


def _rows(name: str, rows: list, args: dict | None = None) -> dict:
    return _ok(name, {"ok": True, "rows": rows}, args)


def test_keep_80000() -> None:
    runs = [_rows("get_quotes_series", [{"value": "80000"}])]
    out = ground_numbers("涨到 80000", runs)
    assert "80000" in out
    assert REPLACE not in out


def test_reject_90000() -> None:
    runs = [_rows("get_quotes_series", [{"value": "80000"}])]
    out = ground_numbers("涨到 90000", runs)
    assert "90000" not in out
    assert REPLACE in out


def test_minus_5_not_authorized_by_5() -> None:
    runs = [_rows("get_quotes_series", [{"value": "5"}])]
    out = ground_numbers("变动 -5", runs)
    assert "-5" not in out
    assert REPLACE in out


def test_bare_5_not_authorized_by_minus_5() -> None:
    runs = [_rows("get_quotes_series", [{"value": "-5"}])]
    out = ground_numbers("变动 5", runs)
    assert re_has_independent_5(out) is False


def test_plus_5_not_authorized_by_5() -> None:
    runs = [_rows("get_quotes_series", [{"value": "5"}])]
    out = ground_numbers("+5", runs)
    assert "+5" not in out
    assert REPLACE in out


def test_u2212_minus_5_back_substitution() -> None:
    """回代：{"value":"5"} + 模型「变动 −5」不得保留 −5 / -5。"""
    runs = [_rows("get_quotes_series", [{"value": "5"}])]
    allowed = allowed_from_tool_runs(runs)
    assert "5" in allowed
    assert "-5" not in allowed
    folded = fold_num("变动 −5")
    assert "−" not in folded
    assert "-5" in folded
    out = ground_answer("变动 −5", allowed)
    assert "−5" not in out
    assert "-5" not in out
    assert REPLACE in out
    assert ground_numbers("变动 −5", runs) == out


def test_fullwidth_percent_not_authorized_by_5() -> None:
    runs = [_rows("get_quotes_series", [{"value": "5"}])]
    out = ground_numbers("5％", runs)
    assert "5％" not in out
    assert "5%" not in out
    assert REPLACE in out


def test_empty_allowed_replaces_1e6() -> None:
    out = ground_numbers("1e6", [])
    assert "1e6" not in out
    assert "1000000" not in out
    assert REPLACE in out


def test_spaced_minus_and_percent_not_kept() -> None:
    runs = [_rows("get_quotes_series", [{"value": "5"}])]
    out_minus = ground_numbers("- 5", runs)
    assert "-5" not in out_minus
    assert REPLACE in out_minus
    out_pct = ground_numbers("5 %", runs)
    assert "5%" not in out_pct
    assert REPLACE in out_pct


def test_underscore_and_space_thousands_replaced() -> None:
    runs = [_rows("x", [{"value": "1"}, {"value": "0"}])]
    for text in ("1_000", "1 000"):
        out = ground_numbers(text, runs)
        assert "1000" not in out
        assert "1_000" not in out
        assert REPLACE in out


def test_apostrophe_thousands_replaced() -> None:
    runs = [_rows("x", [{"value": "80"}, {"value": "0"}])]
    for text in ("80'000", "80’000"):
        out = ground_numbers(text, runs)
        assert "80000" not in out
        assert REPLACE in out


def test_empty_allowed_replaces_leading_dot() -> None:
    out = ground_numbers(".5% 与 -.5", [])
    assert ".5%" not in out
    assert "-.5" not in out
    assert "0.5%" not in out
    assert REPLACE in out


def test_utc_crosses_shanghai_calendar_day() -> None:
    runs = [_rows("get_quotes_series", [{"observedAt": "2026-08-19 20:00:00Z"}])]
    out = ground_numbers("2026-08-20", runs)
    assert "2026-08-20" in out
    assert REPLACE not in out


def test_comma_80000_authorized_by_trailing_zeros() -> None:
    runs = [_rows("get_quotes_series", [{"value": "80000.0000"}])]
    out = ground_numbers("80,000", runs)
    assert "80,000" in out


def test_date_and_value_from_output() -> None:
    runs = [
        _rows(
            "get_quotes_series",
            [{"value": "80000", "observedAt": "2026-08-19T00:00:00+08:00"}],
        )
    ]
    out = ground_numbers("截至 2026-08-19，铜价 80000 元", runs)
    assert "2026-08-19" in out
    assert "80000" in out


def test_forged_2020_date_replaced() -> None:
    runs = [_rows("get_quotes_series", [{"value": "80000"}])]
    out = ground_numbers("2020-01-01 涨到 80000", runs)
    assert "2020-01-01" not in out
    assert "80000" in out
    assert REPLACE in out


def test_fulltext_content_digits_allowed() -> None:
    runs = [
        _ok(
            "fetch_fulltext",
            {
                "ok": True,
                "itemId": 1,
                "content": "现货铜 80000 吨",
                "title": "t",
                "summaryZh": None,
                "scoredAt": None,
                "sourceName": "s",
            },
        )
    ]
    out = ground_numbers("价格 80000", runs)
    assert "80000" in out


def test_failed_item_id_90000_excluded() -> None:
    runs = [
        _rows("get_item", [{"value": "80000", "id": 1}], {"itemId": 1}),
        _fail("get_item", {"ok": False, "reason": "NOT_VISIBLE"}, {"itemId": 90000}),
    ]
    allowed = allowed_from_tool_runs(runs)
    assert "80000" in allowed
    assert "90000" not in allowed
    out = ground_numbers("涨到 80000 对比 90000", runs)
    assert "80000" in out
    assert "90000" not in out


def test_successful_search_days_30_not_in_output() -> None:
    runs = [
        _rows(
            "search_items",
            [{"id": 1, "title": "铜价上涨"}],
            {"q": "铜", "days": 30},
        )
    ]
    out = ground_numbers("最近 30 天", runs)
    assert "30" not in out
    assert REPLACE in out


def test_empty_allowed_replaces_chinese_and_relative() -> None:
    out = ground_numbers("八万元 百分之五 三成 廿万元 半成 去年", [])
    for word in ("八万元", "百分之五", "三成", "廿万元", "半成", "去年"):
        assert word not in out
    assert REPLACE in out


def test_proper_names_and_jinnian_kept() -> None:
    out = ground_numbers("一带一路 十四五 今年同比", [])
    assert "一带一路" in out
    assert "十四五" in out
    assert "今年同比" in out


def test_allowed_5_still_replaces_wan_and_zhao() -> None:
    runs = [_rows("x", [{"value": "5"}])]
    out = ground_numbers("涨了5万和5兆", runs)
    assert "5万" not in out
    assert "5兆" not in out
    assert REPLACE in out


def test_model_cutoff_date_not_exempt_without_tool_evidence() -> None:
    """工具只给 80000 时，模型正文「数据截止：2099-01-01」必须被替换。"""
    runs = [_rows("get_quotes_series", [{"value": "80000"}])]
    out = ground_numbers("铜价 80000 元。\n数据截止：2099-01-01", runs)
    assert "80000" in out
    assert "2099-01-01" not in out
    assert REPLACE in out


def test_canon_keeps_plus_sign() -> None:
    assert canon("+5") == "+5"
    assert canon("5") == "5"
    assert canon("1e6") == "1000000"
    assert canon("80000.0000") == "80000"
    assert canon(".5%") == "0.5%"
    assert canon("80,000") == "80000"


def re_has_independent_5(text: str) -> bool:
    return bool(__import__("re").search(r"(?<![0-9.])5(?![0-9.%])", text))
