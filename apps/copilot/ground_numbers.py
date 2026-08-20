"""groundNumbers: fold / TOKEN / allowed set / answer sweep (design §3.2.1-c)."""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

# DATE 正则必须先于 fold_num 定义（design L456–480，逐字抄入）
DATE = re.compile(r'\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?')


def fold_num(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = (s.replace("\u2212", "-").replace("\u2013", "-").replace("\u2014", "-")
           .replace("\uff0d", "-").replace("\uff0b", "+").replace("\uff05", "%"))
    # DATE 必须在数字分组折叠之前抽出并 mask，否则 "2026-08-19 20:00:00Z"
    # 会被第三段收成 "2026-08-1920:00:00Z"，UTC 跨日日历日丢失。
    dates = list(DATE.finditer(s))
    masks = []
    # 从右往左替换，避免改长度后后续 match 偏移失效
    for i, m in enumerate(reversed(dates)):
        idx = len(dates) - 1 - i
        token = f"\x00D{idx}\x00"
        masks.append((token, m.group(0)))
        s = s[:m.start()] + token + s[m.end():]
    s = re.sub(r'([+-])\s+(?=\d)', r'\1', s)      # "- 5" → "-5"
    s = re.sub(r'(?<=\d)\s+(?=%)', '', s)           # "5 %" → "5%"
    s = re.sub(r'(?<=\d)[ _\'\u2019](?=\d)', '', s)  # 1_000 / 1 000 / 80'000 / 80’000
    for token, raw in masks:
        s = s.replace(token, raw)
    return s


TOKEN = re.compile(
    r'(?<![A-Za-z0-9.])([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)(%)?(?![A-Za-z0-9.])'
)

REPLACE = "（工具未给出）"
_SHANGHAI = ZoneInfo("Asia/Shanghai")
_CN_CHARS = "零〇一二三四五六七八九十百千万亿两半廿卅兆壹贰叁肆伍陆柒捌玖拾佰仟"
_TOKEN_CORE = r"[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?"

PROPER = re.compile(r"一带一路|十四五|十三五|十二五|十一五")
PCT_CN = re.compile(r"(?:百分之|千分之)[半廿卅零〇一二三四五六七八九十百千万亿两]+")
UNIT = re.compile(
    rf"(?:(?<![A-Za-z0-9.]){_TOKEN_CORE}(%)?(?![A-Za-z0-9.])|[{_CN_CHARS}]+)[万亿千兆成元]"
)
CN_RUN = re.compile(rf"[{_CN_CHARS}]{{2,}}")
RELATIVE = re.compile(r"去年|昨日|本月")
_CUTOFF_MARK = "数据截止"


def canon(raw: str) -> str:
    s = raw.strip().replace(",", "").replace("_", "")
    pct = s.endswith("%")
    if pct:
        s = s[:-1]
    sign = ""
    if s.startswith("+"):
        sign = "+"
        s = s[1:]
    elif s.startswith("-"):
        sign = "-"
        s = s[1:]
    if s.startswith("."):
        s = "0" + s
    if re.search(r"[eE]", s):
        try:
            s = format(Decimal(s), "f")
        except InvalidOperation:
            return sign + s + ("%" if pct else "")
    try:
        digits = format(Decimal(s).normalize(), "f")
    except InvalidOperation:
        return sign + s + ("%" if pct else "")
    if "." in digits:
        digits = digits.rstrip("0").rstrip(".")
    return sign + digits + ("%" if pct else "")


def _format_number(value: int | float | Decimal) -> str:
    if isinstance(value, bool):
        raise TypeError("bool is not a number token")
    if isinstance(value, int):
        return str(value)
    if isinstance(value, Decimal):
        return format(value, "f")
    return format(value, "f")


def shanghai_calendar_day(raw: str) -> str | None:
    s = raw.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    norm = s
    if norm.endswith("Z"):
        norm = norm[:-1] + "+00:00"
    if " " in norm and "T" not in norm:
        norm = norm.replace(" ", "T", 1)
    try:
        dt = datetime.fromisoformat(norm)
    except ValueError:
        return s[:10] if len(s) >= 10 else None
    if dt.tzinfo is None:
        return dt.strftime("%Y-%m-%d")
    return dt.astimezone(_SHANGHAI).strftime("%Y-%m-%d")


def add_date(raw: str, allowed: set[str]) -> None:
    allowed.add(raw)
    if len(raw) >= 10:
        allowed.add(raw[:10])
    day = shanghai_calendar_day(raw)
    if day:
        allowed.add(day)


def collect_from_string(s: str, allowed: set[str]) -> None:
    folded = fold_num(s)
    last = 0
    frags: list[str] = []
    for m in DATE.finditer(folded):
        add_date(m.group(0), allowed)
        frags.append(folded[last : m.start()])
        last = m.end()
    frags.append(folded[last:])
    for frag in frags:
        for m in TOKEN.finditer(frag):
            allowed.add(canon(m.group(0)))


def collect_from_value(value: object, allowed: set[str]) -> None:
    if isinstance(value, bool) or value is None:
        return
    if isinstance(value, (int, float, Decimal)):
        allowed.add(canon(_format_number(value)))
        return
    if isinstance(value, str):
        collect_from_string(value, allowed)
        return
    if isinstance(value, dict):
        for inner in value.values():
            collect_from_value(inner, allowed)
        return
    if isinstance(value, (list, tuple)):
        for inner in value:
            collect_from_value(inner, allowed)


def _nonempty(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, (str, list, dict, tuple)):
        return len(value) > 0
    return True


def is_success_evidence(run: dict) -> bool:
    result = run.get("result")
    if not isinstance(result, dict) or result.get("ok") is not True:
        return False
    name = run.get("name")
    if name == "get_daily_report":
        rows = result.get("rows")
        if not isinstance(rows, list) or not rows:
            return _nonempty(result.get("sections"))
        return any(isinstance(row, dict) and _nonempty(row.get("sections")) for row in rows)
    if name == "fetch_fulltext":
        if isinstance(result.get("content"), str) and result["content"].strip():
            return True
        rows = result.get("rows")
        if isinstance(rows, list):
            return any(
                isinstance(row, dict) and isinstance(row.get("content"), str) and row["content"].strip()
                for row in rows
            )
        return False
    rows = result.get("rows")
    return isinstance(rows, list) and len(rows) > 0


def allowed_from_tool_runs(runs: list) -> set[str]:
    allowed: set[str] = set()
    for run in runs:
        if not is_success_evidence(run):
            continue
        result = run.get("result")
        if isinstance(result, dict):
            collect_from_value(result, allowed)
    return allowed


def _cutoff_line_start(folded: str) -> int | None:
    idx = folded.rfind("\n")
    last = folded if idx < 0 else folded[idx + 1 :]
    if _CUTOFF_MARK in last:
        return 0 if idx < 0 else idx + 1
    return None


def ground_answer(text: str, allowed: set[str]) -> str:
    folded = fold_num(text)
    cutoff = _cutoff_line_start(folded)
    candidates: list[tuple[int, int, str, re.Match[str]]] = []
    for kind, pattern in (
        ("keep", PROPER),
        ("replace", PCT_CN),
        ("replace", UNIT),
        ("replace", CN_RUN),
        ("replace", RELATIVE),
        ("token", TOKEN),
        ("date", DATE),
    ):
        for m in pattern.finditer(folded):
            candidates.append((m.start(), m.end(), kind, m))
    candidates.sort(key=lambda item: (item[0], -(item[1] - item[0])))
    chosen: list[tuple[int, int, str, re.Match[str]]] = []
    occupied: list[tuple[int, int]] = []
    for start, end, kind, match in candidates:
        if any(not (end <= left or start >= right) for left, right in occupied):
            continue
        chosen.append((start, end, kind, match))
        occupied.append((start, end))
    chosen.sort(key=lambda item: item[0], reverse=True)
    out = folded
    for start, end, kind, match in chosen:
        if kind == "keep":
            continue
        if kind == "token":
            if canon(match.group(0)) in allowed:
                continue
            out = out[:start] + REPLACE + out[end:]
            continue
        if kind == "date":
            if cutoff is not None and start >= cutoff:
                continue
            raw = match.group(0)
            if raw in allowed or (len(raw) >= 10 and raw[:10] in allowed):
                continue
            out = out[:start] + REPLACE + out[end:]
            continue
        out = out[:start] + REPLACE + out[end:]
    return out


def ground_numbers(text: str, runs: list) -> str:
    return ground_answer(text, allowed_from_tool_runs(runs))
