from __future__ import annotations


def test_reply_finished_reason_from_types() -> None:
    from agentscope.types import ReplyFinishedReason

    assert ReplyFinishedReason is not None
