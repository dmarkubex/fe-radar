"""T-CH-01 验收标准 2：`COPILOT_LLM_CONTEXT_SIZE` 解析与非法回退。

直接测 `config._parse_context_size`：未设/空串默认 32768；合法正整数跟随；
`abc` / `0` / `-5` 回退 32768 并记 warning。不经 WorkerGatewayModel 绕路。
"""

from __future__ import annotations

import logging

from config import _parse_context_size

_DEFAULT = 32_768


def test_parse_context_size_unset_or_empty_defaults() -> None:
    assert _parse_context_size(None) == _DEFAULT
    assert _parse_context_size("") == _DEFAULT


def test_parse_context_size_valid_positive_int() -> None:
    assert _parse_context_size("65536") == 65536


def test_parse_context_size_invalid_falls_back_with_warning(caplog) -> None:
    with caplog.at_level(logging.WARNING, logger="config"):
        for raw in ("abc", "0", "-5"):
            assert _parse_context_size(raw) == _DEFAULT
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert len(warnings) == 3
    assert all("COPILOT_LLM_CONTEXT_SIZE" in r.getMessage() for r in warnings)
