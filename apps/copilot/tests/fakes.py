from __future__ import annotations

import base64
import json
import os
import time
from typing import Any

from agentscope.message import TextBlock, ToolCallBlock
from agentscope.model import ChatResponse, FinishedReason
from auth import build_canonical, compute_signature
from llm.gateway_client import WorkerGatewayModel, filter_tools_for_worker
from llm.msg_adapter import msgs_to_chat_messages

INTERNAL_SECRET = "test-internal-secret"
WORKER_TOKEN = "test-worker-token"


class Col:
    def __init__(self, name: str) -> None:
        self.name = name


class FakeCursor:
    def __init__(self, rows: list, colnames: list[str]) -> None:
        self._rows = rows
        self.description = [Col(name) for name in colnames]

    async def fetchall(self) -> list:
        return self._rows

    async def fetchone(self) -> Any:
        return self._rows[0] if self._rows else None


class FakeConn:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict | None]] = []
        self._queue: list[tuple[list | None, BaseException | None, list[str]]] = []

    def enqueue(
        self,
        rows: list | None = None,
        exc: BaseException | None = None,
        colnames: list[str] | None = None,
    ) -> None:
        self._queue.append((rows, exc, colnames or []))

    def transaction(self) -> "_TxnCM":
        return _TxnCM()

    async def execute(self, sql: str, params: dict | None = None) -> FakeCursor:
        self.calls.append((sql, params))
        stripped = sql.strip().upper()
        if stripped.startswith(("SAVEPOINT", "ROLLBACK", "RELEASE")):
            return FakeCursor([], [])
        if not self._queue:
            return FakeCursor([], [])
        rows, exc, colnames = self._queue.pop(0)
        if exc is not None:
            raise exc
        return FakeCursor(rows or [], colnames)

class FakePool:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn
        self.conns_acquired: list[FakeConn] = []

    def connection(self) -> "_ConnCM":
        self.conns_acquired.append(self.conn)
        return _ConnCM(self.conn)

    async def close(self) -> None:
        return None

class _ConnCM:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn

    async def __aenter__(self) -> FakeConn:
        return self.conn

    async def __aexit__(self, *_exc: object) -> None:
        return None


class _TxnCM:
    async def __aenter__(self) -> "_TxnCM":
        return self

    async def __aexit__(self, *_exc: object) -> None:
        return None


class ScriptedGateway(WorkerGatewayModel):
    """Fake worker: scripted ChatResponse chunks, records _call_api messages."""

    def __init__(self, scripts: list[list[ChatResponse]]) -> None:
        super().__init__(worker_base_url="http://worker:8071", service_token=WORKER_TOKEN)
        self.scripts = [list(script) for script in scripts]
        self.calls: list[dict] = []

    async def _call_api(self, model_name, messages, tools=None, tool_choice=None, **kwargs):
        self.calls.append(
            {
                "messages": msgs_to_chat_messages(messages),
                "tools": filter_tools_for_worker(tools),
            }
        )
        chunks = self.scripts.pop(0) if self.scripts else []

        async def _stream():
            acc: list = []
            for chunk in chunks:
                if not chunk.is_last:
                    acc.extend(list(chunk.content))
                    yield chunk
            last_content = chunks[-1].content if chunks and chunks[-1].is_last else acc
            yield ChatResponse(
                content=list(last_content),
                is_last=True,
                finished_reason=FinishedReason.COMPLETED,
            )

        return _stream()


def tool_call_then_text(
    name: str,
    arguments: str,
    text: str,
    call_id: str = "c1",
) -> list[list[ChatResponse]]:
    call = ToolCallBlock(id=call_id, name=name, input=arguments)
    token = TextBlock(text=text)
    return [
        [
            ChatResponse(content=[call], is_last=False),
            ChatResponse(content=[call], is_last=True, finished_reason=FinishedReason.COMPLETED),
        ],
        [
            ChatResponse(content=[token], is_last=False),
            ChatResponse(content=[token], is_last=True, finished_reason=FinishedReason.COMPLETED),
        ],
    ]


class ChatFakeConn(FakeConn):
    """Route /chat SQL by statement text so lock / insert / history stay consistent."""

    def __init__(self) -> None:
        super().__init__()
        self.session_id = 1
        self.user_id = 7
        self.source = "ask"
        self.item_id: int | None = None
        self.title: str | None = None
        self.turn_locked_at: Any = None
        self.lock_fail = False
        self.raise_on_user_insert = False
        self.user_message_id = 10
        self.assistant_message_id = 11
        self.next_msg_id = 10
        self.visible_ids: set[int] = {1}
        self.item_row = (1, "铜价", "摘要", "2026-08-19T00:00:00+08:00", "SMM")
        self.history_rows: list[tuple[int, str, str]] = []
        self.user_inserts: list[dict] = []
        self.assistant_inserts: list[dict] = []
        self.audit_inserts: list[dict] = []

    async def execute(self, sql: str, params: dict | None = None) -> FakeCursor:
        self.calls.append((sql, params))
        compact = " ".join(sql.split()).lower()
        params = params or {}

        if "set turn_locked_at=%(ts)s" in compact and "returning" in compact:
            if self.lock_fail or self.turn_locked_at is not None:
                return FakeCursor([], ["id", "turn_locked_at"])
            self.turn_locked_at = params.get("ts")
            return FakeCursor([(self.session_id, self.turn_locked_at)], ["id", "turn_locked_at"])

        if "set turn_locked_at=null" in compact:
            if params.get("ts") == self.turn_locked_at:
                self.turn_locked_at = None
            return FakeCursor([], [])

        if compact.startswith("insert into copilot.sessions"):
            self.source = params.get("source") or "ask"
            self.item_id = params.get("item_id")
            self.title = params.get("title")
            return FakeCursor(
                [(self.session_id, self.source, self.item_id)],
                ["id", "source", "item_id"],
            )

        if "from copilot.sessions" in compact:
            if params.get("uid") != self.user_id or params.get("id") not in (None, self.session_id):
                if params.get("id") is not None and (
                    params.get("uid") != self.user_id or params.get("id") != self.session_id
                ):
                    return FakeCursor(
                        [],
                        ["id", "title", "source", "item_id", "last_active", "created_at"],
                    )
            return FakeCursor(
                [(self.session_id, self.title, self.source, self.item_id, None, None)],
                ["id", "title", "source", "item_id", "last_active", "created_at"],
            )

        if compact.startswith("insert into copilot.messages"):
            if params.get("role") == "user" and self.raise_on_user_insert:
                raise RuntimeError("insert user failed")
            mid = self.next_msg_id
            self.next_msg_id += 1
            if params.get("role") == "user":
                self.user_inserts.append(params)
                self.user_message_id = mid
            else:
                self.assistant_inserts.append(params)
                self.assistant_message_id = mid
            return FakeCursor([(mid,)], ["id"])

        if "from copilot.messages" in compact and "id <" in compact:
            current = params.get("current_id", 0)
            rows = [row for row in self.history_rows if row[0] < current]
            rows = sorted(rows, key=lambda row: row[0], reverse=True)[:12]
            return FakeCursor([(row[1], row[2]) for row in rows], ["role", "content"])

        if compact.startswith("insert into copilot.audit_log"):
            self.audit_inserts.append(params)
            return FakeCursor([], [])

        if "from copilot.visible_items" in compact:
            if "any(%(ids)s)" in compact:
                ids = params.get("ids") or []
                return FakeCursor(
                    [(item,) for item in ids if item in self.visible_ids],
                    ["id"],
                )
            iid = params.get("iid", params.get("item_id"))
            if iid in self.visible_ids:
                return FakeCursor(
                    [self.item_row],
                    ["id", "title", "summary_zh", "scored_at", "source_name"],
                )
            return FakeCursor([], ["id", "title", "summary_zh", "scored_at", "source_name"])

        if "from item_entities" in compact:
            return FakeCursor([], ["id", "canonical_name", "type"])

        if "set last_active" in compact:
            return FakeCursor([], [])

        stripped = sql.strip().upper()
        if stripped.startswith(("SAVEPOINT", "ROLLBACK", "RELEASE")):
            return FakeCursor([], [])
        if self._queue:
            rows, exc, colnames = self._queue.pop(0)
            if exc is not None:
                raise exc
            return FakeCursor(rows or [], colnames)
        return FakeCursor([], [])


def text_only(text: str) -> list[list[ChatResponse]]:
    token = TextBlock(text=text)
    return [
        [
            ChatResponse(content=[token], is_last=False),
            ChatResponse(content=[token], is_last=True, finished_reason=FinishedReason.COMPLETED),
        ]
    ]


def hmac_headers(
    method: str,
    path: str,
    body: bytes,
    user_id: int,
    role: str,
    secret: str = INTERNAL_SECRET,
    *,
    ts: str | None = None,
    nonce: str | None = None,
) -> dict[str, str]:
    ts = str(int(time.time())) if ts is None else ts
    nonce = os.urandom(16).hex() if nonce is None else nonce
    canonical = build_canonical(method, path, ts, nonce, body, user_id, role)
    signature = compute_signature(canonical, secret)
    user = base64.b64encode(
        json.dumps({"userId": user_id, "role": role}, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    return {
        "x-fer-ts": ts,
        "x-fer-nonce": nonce,
        "x-fer-user": user,
        "x-fer-internal-auth": signature,
    }


# ---------------------------------------------------------------------------
# T-CH-01 fakes: MockTransport 工厂（生产 _call_api 完整执行）+ 独立连接身份记录
# ---------------------------------------------------------------------------


def sse_frames_bytes(*frames: dict) -> bytes:
    """构造 worker /internal/llm SSE 响应字节流（data: 行 + 空行分隔）。"""
    return "".join(f"data: {json.dumps(f, ensure_ascii=False)}\n\n" for f in frames).encode("utf-8")


class MockTransportRecorder:
    """T-CH-01 验收标准 1 的 fake 边界：不覆写 `_call_api`（被测生产逻辑必须真正运行）。

    通过 `WorkerGatewayModel.__init__(client=...)` 注入带 `httpx.MockTransport` 的 client，
    mock transport handler 记录生产 `_call_api` 实际发出的 POST body（最终 payload）；
    测试侧在调用入口另行记录未过滤的原始 tools/tool_choice（两份都要有）。
    """

    def __init__(self, scripts: list[bytes] | None = None) -> None:
        # 最终出站 payload（由生产 _call_api 产出，MockTransport 捕获）
        self.requests: list[dict] = []
        # 未过滤的原始调用参数（测试侧在 _call_api 入口包装记录）
        self.raw_calls: list[dict] = []
        self._scripts = list(scripts or [])

    def _handler(self, request: Any) -> Any:
        import httpx

        self.requests.append(json.loads(request.content.decode("utf-8")))
        content = self._scripts.pop(0) if self._scripts else sse_frames_bytes({"type": "done"})
        return httpx.Response(200, content=content, headers={"content-type": "text/event-stream"})

    def build_model(self, **kwargs: Any) -> "WorkerGatewayModel":
        import httpx

        from llm.gateway_client import WorkerGatewayModel

        client = httpx.AsyncClient(transport=httpx.MockTransport(self._handler))
        model = WorkerGatewayModel(
            worker_base_url="http://worker.test",
            service_token=WORKER_TOKEN,
            client=client,
            **kwargs,
        )
        # 在生产 _call_api 外层记录未过滤的原始调用参数（仅观测，不改行为）
        original_call_api = model._call_api

        async def _recording_call_api(model_name, messages, tools=None, tool_choice=None, **kw):
            self.raw_calls.append(
                {"tools": tools, "tool_choice": tool_choice}
            )
            return await original_call_api(
                model_name, messages, tools=tools, tool_choice=tool_choice, **kw
            )

        model._call_api = _recording_call_api  # type: ignore[method-assign]
        return model


class _ConnDelegate:
    """委托到底层 ChatFakeConn 的独立连接对象：SQL 行为相同、对象身份不同。
    自身记录执行过的 SQL，供"哪次锁释放走了哪个连接"的对象身份级断言使用。"""

    def __init__(self, target: "ChatFakeConn") -> None:
        self._target = target
        self.executed: list[str] = []

    async def execute(self, sql: str, params: dict | None = None) -> FakeCursor:
        self.executed.append(sql)
        return await self._target.execute(sql, params)

    def transaction(self) -> "_TxnCM":
        return _TxnCM()


class DistinctConnPool(FakePool):
    """T-CH-01 验收标准 6 第三条：每次 `connection()` 返回一个新的 `_ConnDelegate` 对象，
    使"看门狗备份路径连接 ≠ gen() 主路径连接"成为对象身份级可断言的事实。"""

    def __init__(self, conn: ChatFakeConn) -> None:
        super().__init__(conn)
        self.acquired_delegates: list[_ConnDelegate] = []

    def connection(self) -> "_ConnCM":
        delegate = _ConnDelegate(self.conn)
        self.acquired_delegates.append(delegate)
        return _ConnCM(delegate)
