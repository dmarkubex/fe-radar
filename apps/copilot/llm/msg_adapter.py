"""AgentScope Msg → worker ChatMessage (design §3.2.1-b A)."""

from __future__ import annotations

from typing import Any

from agentscope.message import HintBlock, TextBlock, ToolCallBlock, ToolResultBlock


def _text_of(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, TextBlock):
        return value.text
    if isinstance(value, list):
        return "".join(_text_of(item) for item in value)
    return ""


def _hint_text(block: HintBlock) -> str:
    return _text_of(block.hint)


def _tool_result_text(block: ToolResultBlock) -> str:
    return _text_of(block.output)


def msgs_to_chat_messages(msgs: list[Any]) -> list[dict]:
    out: list[dict] = []
    for msg in msgs:
        role = getattr(msg, "role", None)
        raw_content = getattr(msg, "content", [])
        if isinstance(raw_content, str):
            blocks: list[Any] = [TextBlock(text=raw_content)]
        else:
            blocks = list(raw_content or [])

        texts: list[str] = []
        tool_calls: list[ToolCallBlock] = []
        tool_results: list[ToolResultBlock] = []
        hints: list[HintBlock] = []
        for block in blocks:
            if isinstance(block, HintBlock):
                hints.append(block)
            elif isinstance(block, ToolCallBlock):
                tool_calls.append(block)
            elif isinstance(block, ToolResultBlock):
                tool_results.append(block)
            elif isinstance(block, TextBlock):
                texts.append(block.text)

        joined = "".join(texts)
        if role == "system":
            out.append({"role": "system", "content": joined})
            for hint in hints:
                out.append({"role": "user", "content": _hint_text(hint)})
            continue

        for hint in hints:
            out.append({"role": "user", "content": _hint_text(hint)})

        if tool_calls:
            calls = []
            for call in tool_calls:
                arguments = call.input
                if not isinstance(arguments, str):
                    arguments = str(arguments)
                calls.append({"id": call.id, "name": call.name, "arguments": arguments})
            out.append({"role": "assistant", "content": joined, "tool_calls": calls})

        for result in tool_results:
            out.append(
                {
                    "role": "tool",
                    "content": _tool_result_text(result),
                    "tool_call_id": result.id,
                }
            )

        # 已发 tool / tool_calls，或 HintBlock 已转 user：不要再补空 assistant
        if tool_calls or tool_results or (hints and joined == ""):
            continue

        if role in ("user", "assistant"):
            out.append({"role": role, "content": joined})
            continue

        if joined:
            out.append({"role": role or "user", "content": joined})

    return out
