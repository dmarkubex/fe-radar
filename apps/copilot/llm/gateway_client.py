"""WorkerGatewayModel — AgentScope ChatModelBase over worker /internal/llm."""

from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncGenerator
from typing import Any
from uuid import uuid4

import httpx
from agentscope.credential import CredentialBase
from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import TextBlock, ToolCallBlock
from agentscope.model import ChatModelBase, ChatResponse, ChatUsage, FinishedReason
from pydantic import BaseModel

from llm.msg_adapter import msgs_to_chat_messages
from tools.registry import TOOL_NAMES

logger = logging.getLogger(__name__)

WORKER_LLM_TIMEOUT_SEC = 60.0


class GatewayParams(BaseModel):
    temperature: float = 0.2


class EmptyCredential(CredentialBase):
    """Satisfies ChatModelBase. get_token / get_chat_model_class are never used."""

    @classmethod
    def get_chat_model_class(cls) -> type[ChatModelBase]:
        return ChatModelBase


class WorkerGatewayError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _schema_name(schema: dict) -> str | None:
    fn = schema.get("function")
    if isinstance(fn, dict) and isinstance(fn.get("name"), str):
        return fn["name"]
    name = schema.get("name")
    return name if isinstance(name, str) else None


def filter_tools_for_worker(tools: list[dict] | None) -> list[dict]:
    if not tools:
        return []
    allowed = set(TOOL_NAMES)
    return [item for item in tools if _schema_name(item) in allowed]


def _usage_from_data(data: object, elapsed: float) -> ChatUsage | None:
    if not isinstance(data, dict):
        return None
    try:
        return ChatUsage(
            input_tokens=int(data.get("input_tokens") or data.get("prompt_tokens") or 0),
            output_tokens=int(data.get("output_tokens") or data.get("completion_tokens") or 0),
            time=float(data.get("time") or elapsed),
        )
    except (TypeError, ValueError):
        return None


def _token_text(data: object) -> str:
    if isinstance(data, str):
        return data
    if isinstance(data, dict):
        text = data.get("text")
        if isinstance(text, str):
            return text
    return "" if data is None else str(data)


async def iter_sse_data_lines(response: httpx.Response) -> AsyncGenerator[str, None]:
    buf = b""
    async for chunk in response.aiter_bytes():
        buf += chunk
        while b"\n\n" in buf:
            raw, buf = buf.split(b"\n\n", 1)
            for line in raw.split(b"\n"):
                if line.startswith(b"data: "):
                    yield line[6:].decode("utf-8")


class WorkerGatewayModel(ChatModelBase):
    def __init__(
        self,
        *,
        worker_base_url: str | None = None,
        service_token: str | None = None,
        correlation_id: str | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(
            credential=EmptyCredential(),
            model="deepseek-via-worker",
            parameters=GatewayParams(),
            stream=True,
            max_retries=0,
        )
        self.formatter = OpenAIChatFormatter()
        self.worker_base_url = (worker_base_url or "http://worker:8071").rstrip("/")
        self.service_token = service_token or ""
        self.correlation_id = correlation_id or uuid4().hex
        self._client = client

    def _url(self) -> str:
        return f"{self.worker_base_url}/internal/llm"

    async def _call_api(
        self,
        model_name: str,
        messages: list,
        tools: list[dict] | None = None,
        tool_choice: Any = None,
        **kwargs: Any,
    ) -> AsyncGenerator[ChatResponse, None]:
        payload = {
            "messages": msgs_to_chat_messages(messages),
            "tools": filter_tools_for_worker(tools),
            "temperature": getattr(self.parameters, "temperature", 0.2),
        }
        headers = {
            "Authorization": f"Bearer {self.service_token}",
            "x-fer-correlation-id": self.correlation_id,
            "content-type": "application/json",
        }

        async def _stream() -> AsyncGenerator[ChatResponse, None]:
            acc: list[TextBlock | ToolCallBlock] = []
            usage: ChatUsage | None = None
            started = time.monotonic()
            client = self._client
            own_client = client is None
            if own_client:
                client = httpx.AsyncClient(timeout=WORKER_LLM_TIMEOUT_SEC)
            assert client is not None
            try:
                async with client.stream(
                    "POST",
                    self._url(),
                    json=payload,
                    headers=headers,
                ) as response:
                    if response.status_code >= 400:
                        code = "COPILOT_UPSTREAM"
                        try:
                            body = await response.aread()
                            parsed = json.loads(body.decode("utf-8"))
                            if isinstance(parsed, dict):
                                err = parsed.get("error")
                                if isinstance(err, dict) and isinstance(err.get("code"), str):
                                    code = err["code"]
                                elif isinstance(parsed.get("code"), str):
                                    code = parsed["code"]
                        except Exception:
                            pass
                        raise WorkerGatewayError(code)
                    async for line in iter_sse_data_lines(response):
                        try:
                            frame = json.loads(line)
                        except json.JSONDecodeError:
                            logger.warning("invalid sse json")
                            continue
                        if not isinstance(frame, dict):
                            continue
                        kind = frame.get("type")
                        data = frame.get("data")
                        if kind == "token":
                            text = _token_text(data)
                            block = TextBlock(text=text)
                            acc.append(block)
                            yield ChatResponse(content=[block], is_last=False)
                        elif kind == "tool_call":
                            if not isinstance(data, dict):
                                continue
                            arguments = data.get("arguments")
                            if not isinstance(arguments, str):
                                logger.error("tool_call arguments must be json string")
                                continue
                            try:
                                json.loads(arguments)
                            except json.JSONDecodeError:
                                logger.error("tool_call arguments not valid json")
                                continue
                            call_id = data.get("id")
                            name = data.get("name")
                            if not isinstance(call_id, str) or not isinstance(name, str):
                                continue
                            block = ToolCallBlock(id=call_id, name=name, input=arguments)
                            acc.append(block)
                            yield ChatResponse(content=[block], is_last=False)
                        elif kind == "usage":
                            usage = _usage_from_data(data, time.monotonic() - started)
                        elif kind == "done":
                            yield ChatResponse(
                                content=list(acc),
                                is_last=True,
                                finished_reason=FinishedReason.COMPLETED,
                                usage=usage,
                            )
                            return
                        elif kind == "error":
                            code = "COPILOT_UPSTREAM"
                            if isinstance(data, dict) and isinstance(data.get("code"), str):
                                code = data["code"]
                            raise WorkerGatewayError(code)
            finally:
                if own_client:
                    await client.aclose()

        return _stream()
