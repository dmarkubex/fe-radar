from __future__ import annotations


def test_reply_finished_reason_from_types() -> None:
    from agentscope.types import ReplyFinishedReason

    assert ReplyFinishedReason.COMPLETED == "completed"


def test_agent_and_react_config_import() -> None:
    from agentscope.agent import Agent, InjectionConfig, ReActConfig
    from agentscope.types import ReplyFinishedReason

    assert Agent is not None
    assert ReActConfig is not None
    assert InjectionConfig is not None
    assert ReplyFinishedReason.COMPLETED == "completed"


def test_tool_call_block_accepts_json_string_input() -> None:
    from agentscope.message import ToolCallBlock

    block = ToolCallBlock(id="x", name="get_item", input='{"itemId":1}')
    assert block.input == '{"itemId":1}'
    assert isinstance(block.input, str)
