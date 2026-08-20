"""Per-request Agent factory (design §5.0 / §3.2.1). No process-level cache."""

from __future__ import annotations

import json
from typing import Any

from agentscope.agent import Agent, InjectionConfig, ReActConfig
from agentscope.message import (
    AssistantMsg,
    Msg,
    TextBlock,
    ToolCallBlock,
    ToolResultBlock,
    UserMsg,
)
from agentscope.model import ChatModelBase
from agentscope.permission import PermissionContext, PermissionMode
from agentscope.state import AgentState
from agentscope.tool import FunctionTool, Toolkit

from system_prompt import SYSTEM_PROMPT
from tools.cluster import get_cluster
from tools.financials import get_entity_financials
from tools.fulltext import fetch_fulltext
from tools.item import get_item
from tools.quotes import get_quotes_series
from tools.registry import READ_ONLY_TOOLS, TOOL_NAMES
from tools.reports import get_daily_report
from tools.timeline import search_items, semantic_search

_TOOL_FUNCS: dict[str, Any] = {
    "search_items": search_items,
    "semantic_search": semantic_search,
    "get_item": get_item,
    "get_cluster": get_cluster,
    "fetch_fulltext": fetch_fulltext,
    "get_daily_report": get_daily_report,
    "get_entity_financials": get_entity_financials,
    "get_quotes_series": get_quotes_series,
}


def build_toolkit() -> Toolkit:
    if set(_TOOL_FUNCS) != set(TOOL_NAMES):
        raise RuntimeError("tool func map drifted from TOOL_NAMES")
    tools = [
        FunctionTool(_TOOL_FUNCS[name], is_read_only=name in READ_ONLY_TOOLS)
        for name in TOOL_NAMES
    ]
    return Toolkit(tools=tools)


def build_agent(
    model: ChatModelBase,
    *,
    state: AgentState | None = None,
    toolkit: Toolkit | None = None,
) -> Agent:
    if state is None:
        state = AgentState()
    state.permission_context = PermissionContext(mode=PermissionMode.BYPASS)
    return Agent(
        name="copilot",
        system_prompt=SYSTEM_PROMPT,
        model=model,
        toolkit=toolkit or build_toolkit(),
        state=state,
        react_config=ReActConfig(max_iters=8, interruption_raise_cancelled_error=True),
        injection_config=InjectionConfig(timezone="Asia/Shanghai"),
    )


def history_to_msgs(rows: list[dict]) -> list[Msg]:
    msgs: list[Msg] = []
    for row in rows:
        role = row.get("role")
        content = str(row.get("content") or "")[:2000]
        if role == "user":
            msgs.append(UserMsg(name="user", content=content))
        elif role == "assistant":
            msgs.append(AssistantMsg(name="copilot", content=content))
    return msgs


def inject_pre_getitem(state: AgentState, item_id: int, result: dict) -> None:
    state.context.extend(
        [
            AssistantMsg(
                name="copilot",
                content=[
                    ToolCallBlock(
                        id="pre-getitem",
                        name="get_item",
                        input=json.dumps({"itemId": item_id}, ensure_ascii=False),
                    )
                ],
            ),
            AssistantMsg(
                name="copilot",
                content=[
                    ToolResultBlock(
                        id="pre-getitem",
                        name="get_item",
                        output=json.dumps(result, ensure_ascii=False),
                    )
                ],
            ),
        ]
    )


def extract_text(msg: Msg) -> str:
    parts: list[str] = []
    for block in msg.content:
        if isinstance(block, TextBlock):
            parts.append(block.text)
    return "".join(parts)
