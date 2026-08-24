"""T-CH-01 回归：agentscope 上下文压缩触发的工具/tool_choice 透传。

验收标准 1（goal.md）：
- fake 边界下移到 httpx.MockTransport（经 `WorkerGatewayModel.__init__(client=...)` 注入），
  生产 `_call_api`（含压缩放行分支 + `filter_tools_for_worker`）完整执行——**不覆写 `_call_api`**。
- 正向锚点：确实观察到 `tool_choice.mode == "generate_structured_output"` 的请求。
- 最终 payload：发给 worker 的 tools 恰好一个、name 严格匹配；tool_choice 被传递。
- 压缩必须真正工作：合成工具返回有效结构 → state.summary 写入 → 后续推理继续 → reply COMPLETED。
- 负向：工具名不匹配 / 混入多工具 / tool_choice 缺失 → 走业务白名单（被过滤为空或保持子集）。
- 单测试用例自带超时，防止实现有缺陷时把 CI 拖挂。
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from agentscope.agent import Agent, InjectionConfig, ReActConfig
from agentscope.message import UserMsg
from agentscope.state import AgentState
from agentscope.types import ReplyFinishedReason

from agents.copilot_agent import build_agent, history_to_msgs
from tests.fakes import MockTransportRecorder, sse_frames_bytes

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "compression_payload.json"

# SummarySchema 的五个必填字段（agentscope agent/_config.py）
_SUMMARY_ARGS = json.dumps(
    {
        "task_overview": "用户询问铜价",
        "current_state": "已检索到相关条目",
        "important_discoveries": "无",
        "next_steps": "继续回答",
        "context_to_preserve": "无",
    },
    ensure_ascii=False,
)


def _compression_then_text_scripts() -> list[bytes]:
    """脚本 1：压缩请求 → 合成工具调用返回结构化摘要；脚本 2：正常回答。"""
    return [
        # 压缩请求的响应：tool_call 帧（name=generate_structured_output + 摘要 JSON）+ done
        sse_frames_bytes(
            {
                "type": "tool_call",
                "data": {
                    "id": "call_comp_1",
                    "name": "generate_structured_output",
                    "arguments": _SUMMARY_ARGS,
                },
            },
            {"type": "done"},
        ),
        # 压缩完成后正常推理的响应
        sse_frames_bytes({"type": "token", "data": "铜价见条目"}, {"type": "done"}),
    ]


def _with_timeout(seconds: float):
    """测试级超时：实现有缺陷时（如压缩路径再次挂死）单个用例在 seconds 内失败，
    不把 CI 拖入真实挂起。pytest-asyncio auto 模式下装饰 async 测试函数。"""
    import functools

    def deco(fn):
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            return await asyncio.wait_for(fn(*args, **kwargs), timeout=seconds)

        return wrapper

    return deco

@_with_timeout(30)
async def test_compression_request_forwards_synthetic_tool_and_tool_choice(monkeypatch):
    """压缩触发 → 生产 _call_api 放行合成工具 + tool_choice（named-function 形状）→ 压缩成功继续推理。"""
    from agentscope.agent import ContextConfig

    recorder = MockTransportRecorder(scripts=_compression_then_text_scripts())
    model = recorder.build_model(context_size=32)  # 极小 context_size，保证压缩必然触发

    state = AgentState()
    state.context = history_to_msgs(
        [{"role": "user", "content": "x" * 400}, {"role": "assistant", "content": "y" * 400}]
    )
    agent = build_agent(model, state=state)
    agent.context_config = ContextConfig(trigger_ratio=0.05, reserve_ratio=0.01)

    reply_msg = await agent.reply(UserMsg(name="user", content="继续"))
    assert reply_msg.finished_reason == ReplyFinishedReason.COMPLETED

    # 正向锚点：测试侧确实观察到一次压缩请求（未过滤的原始参数）
    comp_raw = [
        c for c in recorder.raw_calls
        if getattr(c["tool_choice"], "mode", None) == "generate_structured_output"
    ]
    assert comp_raw, f"未观察到压缩请求；raw_calls={recorder.raw_calls}"
    raw = comp_raw[0]
    assert raw["tools"] and len(raw["tools"]) == 1
    assert raw["tools"][0]["function"]["name"] == "generate_structured_output"

    # 最终出站 payload（生产 _call_api 产出，MockTransport 捕获）
    comp_final = [
        r for r in recorder.requests
        if isinstance(r.get("tool_choice"), dict)
        and r["tool_choice"].get("function", {}).get("name") == "generate_structured_output"
    ]
    assert comp_final, f"最终 payload 缺失压缩请求；requests={recorder.requests}"
    final = comp_final[0]
    assert final["tools"] and len(final["tools"]) == 1
    assert final["tools"][0]["function"]["name"] == "generate_structured_output"
    assert final["tool_choice"] == {
        "type": "function",
        "function": {"name": "generate_structured_output"},
    }

    # 压缩真正工作：summary 被写入
    assert state.summary, "压缩后 state.summary 未写入"

    # 与契约 fixture 形状一致（tools 恰好 1 个 + named-function tool_choice）
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert final["tool_choice"] == fixture["tool_choice"]
    assert len(final["tools"]) == len(fixture["tools"])
    assert final["tools"][0]["function"]["name"] == fixture["tools"][0]["function"]["name"]
    assert final["tools"][0]["type"] == fixture["tools"][0]["type"]


@_with_timeout(30)
async def test_negative_mismatched_tool_name_still_whitelist_filtered():
    """工具名不匹配（tool_choice 指向 generate_structured_output 但工具名是别的）→ 走白名单过滤。"""
    from agentscope.model import ChatModelBase

    recorder = MockTransportRecorder(scripts=[sse_frames_bytes({"type": "done"})])
    model = recorder.build_model()

    # 直接调用生产 _call_api（不经过 agent），构造负向参数
    from agentscope.message import UserMsg as _U
    from agentscope.tool import ToolChoice

    fake_tool = {
        "type": "function",
        "function": {"name": "get_item", "description": "x", "parameters": {"type": "object"}},
    }
    stream = await model._call_api(
        model_name="m",
        messages=[_U(name="user", content="hi")],
        tools=[fake_tool],
        tool_choice=ToolChoice(mode="generate_structured_output"),  # 名称与工具不匹配
    )
    async for _chunk in stream:
        pass
    assert recorder.requests, "_call_api 未发出请求"
    final = recorder.requests[0]
    # get_item 在业务白名单内 → 保留；但没有 tool_choice（不满足压缩三条件）
    names = [t["function"]["name"] for t in final["tools"]]
    assert names == ["get_item"]
    assert "tool_choice" not in final


@_with_timeout(30)
async def test_negative_multiple_tools_not_treated_as_compression():
    """tools 里混入多个工具（含合成工具）→ 不判为压缩请求 → 走白名单过滤。"""
    from agentscope.message import UserMsg as _U
    from agentscope.tool import ToolChoice

    recorder = MockTransportRecorder(scripts=[sse_frames_bytes({"type": "done"})])
    model = recorder.build_model()

    synthetic = {
        "type": "function",
        "function": {
            "name": "generate_structured_output",
            "description": "x",
            "parameters": {"type": "object"},
        },
    }
    biz = {
        "type": "function",
        "function": {"name": "search_items", "description": "x", "parameters": {"type": "object"}},
    }
    stream = await model._call_api(
        model_name="m",
        messages=[_U(name="user", content="hi")],
        tools=[synthetic, biz],
        tool_choice=ToolChoice(mode="generate_structured_output"),
    )
    async for _chunk in stream:
        pass
    final = recorder.requests[0]
    # 合成工具被过滤掉；业务工具保留；无 tool_choice
    names = [t["function"]["name"] for t in final["tools"]]
    assert names == ["search_items"]
    assert "tool_choice" not in final


@_with_timeout(30)
async def test_negative_missing_tool_choice_still_whitelist_filtered():
    """tool_choice 缺失（None）但 tools 恰好是合成工具 → 不判为压缩 → 合成工具被白名单过滤为空。"""
    from agentscope.message import UserMsg as _U

    recorder = MockTransportRecorder(scripts=[sse_frames_bytes({"type": "done"})])
    model = recorder.build_model()

    synthetic = {
        "type": "function",
        "function": {
            "name": "generate_structured_output",
            "description": "x",
            "parameters": {"type": "object"},
        },
    }
    stream = await model._call_api(
        model_name="m",
        messages=[_U(name="user", content="hi")],
        tools=[synthetic],
        tool_choice=None,
    )
    async for _chunk in stream:
        pass
    final = recorder.requests[0]
    assert final["tools"] == []  # 合成工具不在 TOOL_NAMES 白名单 → 被过滤为空
    assert "tool_choice" not in final
