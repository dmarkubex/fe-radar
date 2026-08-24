import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { EventEmitter } from "node:events";
import type http from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LlmError } from "@fe-radar/shared";
import type {
  ChatStreamDelta,
  ChatStreamRequest,
  LlmClient
} from "@fe-radar/llm";
import type * as FeRadarShared from "@fe-radar/shared";

const mocks = vi.hoisted(() => {
  const chatStream = vi.fn();
  const withScrubber = vi.fn();
  const loadProjectCodes = vi.fn();
  const deepSeek = {
    chatJson: vi.fn(),
    embedding: vi.fn(),
    chatStream: vi.fn()
  };
  return { chatStream, withScrubber, loadProjectCodes, deepSeek };
});

vi.mock("@fe-radar/llm", () => ({
  withScrubber: mocks.withScrubber
}));

vi.mock("../../handlers/context", () => ({
  handlerContext: { deepSeek: mocks.deepSeek },
  loadProjectCodes: mocks.loadProjectCodes,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

vi.mock("@fe-radar/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof FeRadarShared>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  };
});

import { runLlmRequest, setLlmStreamMaxDurationMs } from "../llm";

interface FakeRes extends EventEmitter {
  statusCode: number;
  headersSent: boolean;
  writableEnded: boolean;
  headers: Record<string, string>;
  body: string;
  setHeader: (k: string, v: string) => FakeRes;
  write: (chunk: string) => boolean;
  end: (chunk?: string) => FakeRes;
}

function makeRes(): FakeRes {
  const emitter = new EventEmitter() as FakeRes;
  emitter.body = "";
  emitter.headers = {};
  emitter.statusCode = 0;
  let sent = false;
  let ended = false;
  Object.defineProperty(emitter, "headersSent", { get: () => sent });
  Object.defineProperty(emitter, "writableEnded", { get: () => ended });
  emitter.setHeader = (k: string, v: string): FakeRes => {
    emitter.headers[k.toLowerCase()] = v;
    return emitter;
  };
  emitter.write = (chunk: string): boolean => {
    sent = true;
    emitter.body += chunk;
    return true;
  };
  emitter.end = (chunk?: string): FakeRes => {
    if (chunk !== undefined) emitter.write(chunk);
    sent = true;
    ended = true;
    emitter.emit("finish");
    return emitter;
  };
  return emitter;
}

function asRes(res: FakeRes): http.ServerResponse {
  return res as unknown as http.ServerResponse;
}

function makeReq(): http.IncomingMessage {
  return new EventEmitter() as unknown as http.IncomingMessage;
}

async function* streamOf(
  ...deltas: ChatStreamDelta[]
): AsyncIterable<ChatStreamDelta> {
  for (const d of deltas) yield d;
}

const okMessages = { messages: [{ role: "user" as const, content: "hello" }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadProjectCodes.mockResolvedValue(["ABCD"]);
  mocks.withScrubber.mockImplementation((client: LlmClient) => ({
    chatJson: client.chatJson,
    embedding: client.embedding,
    chatStream: mocks.chatStream
  }));
  mocks.chatStream.mockImplementation((_req: ChatStreamRequest) =>
    streamOf({ type: "token", data: "hi" }, { type: "done" })
  );
});

describe("runLlmRequest", () => {
  it("returns 400 when body carries url/href", async () => {
    const res = makeRes();
    await runLlmRequest(
      makeReq(),
      asRes(res),
      { ...okMessages, url: "https://x" },
      "c-1"
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("LLM_URL_FORBIDDEN");
    expect(mocks.chatStream).not.toHaveBeenCalled();
  });

  it("returns 422 SCRUBBER_FAILED when loadProjectCodes never succeeded (no bytes written)", async () => {
    mocks.loadProjectCodes.mockRejectedValue(new Error("db down"));
    const res = makeRes();
    await runLlmRequest(makeReq(), asRes(res), okMessages, "c-fail");
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("SCRUBBER_FAILED");
    expect(res.headers["content-type"]).toContain("application/json");
    expect(mocks.withScrubber).not.toHaveBeenCalled();
    expect(mocks.chatStream).not.toHaveBeenCalled();
  });

  it("returns 422 SCRUBBER_BLOCKED before SSE starts", async () => {
    mocks.chatStream.mockImplementation(() => {
      throw new LlmError("SCRUBBER_BLOCKED", "scrubber blocked");
    });
    const res = makeRes();
    await runLlmRequest(makeReq(), asRes(res), okMessages, "c-block");
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain("SCRUBBER_BLOCKED");
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("returns 502 COPILOT_UPSTREAM_TIMEOUT before SSE starts", async () => {
    const timeout = new Error("Request timed out");
    timeout.name = "APIConnectionTimeoutError";
    mocks.chatStream.mockImplementation(() => {
      throw timeout;
    });
    const res = makeRes();
    await runLlmRequest(makeReq(), asRes(res), okMessages, "c-to");
    expect(res.statusCode).toBe(502);
    expect(res.body).toContain("COPILOT_UPSTREAM_TIMEOUT");
  });

  it("writes SSE frames and does not abort when the response stays open", async () => {
    const res = makeRes();
    const req = makeReq();
    const reqOn = vi.spyOn(req, "on");
    await runLlmRequest(req, asRes(res), okMessages, "c-ok");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.body).toBe(
      `data: ${JSON.stringify({ type: "token", data: "hi" })}\n\n` +
        `data: ${JSON.stringify({ type: "done" })}\n\n`
    );
    expect(res.writableEnded).toBe(true);
    const streamed = mocks.chatStream.mock.calls[0]?.[0] as
      | ChatStreamRequest
      | undefined;
    expect(streamed?.signal?.aborted).toBe(false);
    expect(reqOn).not.toHaveBeenCalledWith("close", expect.any(Function));
    expect(mocks.withScrubber).toHaveBeenCalledWith(mocks.deepSeek, {
      projectCodes: ["ABCD"]
    });
  });

  it("after SSE starts, errors become error frames and do not change HTTP status", async () => {
    const timeout = new Error("Request timed out");
    timeout.name = "APIConnectionTimeoutError";
    mocks.chatStream.mockImplementation(async function* () {
      yield { type: "token", data: "partial" } satisfies ChatStreamDelta;
      throw timeout;
    });
    const res = makeRes();
    await runLlmRequest(makeReq(), asRes(res), okMessages, "c-mid");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.body).toContain(
      `data: ${JSON.stringify({ type: "token", data: "partial" })}`
    );
    expect(res.body).toContain(
      `data: ${JSON.stringify({ type: "error", data: { code: "COPILOT_UPSTREAM_TIMEOUT" } })}`
    );
  });

  it("aborts the upstream signal when the client closes the response mid-stream", async () => {
    let captured: AbortSignal | undefined;
    let releaseHang!: () => void;
    const hang = new Promise<void>((resolve) => {
      releaseHang = resolve;
    });
    mocks.chatStream.mockImplementation(async function* (
      req: ChatStreamRequest
    ) {
      captured = req.signal;
      yield { type: "token", data: "x" } satisfies ChatStreamDelta;
      await hang;
      yield { type: "done" } satisfies ChatStreamDelta;
    });

    const res = makeRes();
    const pending = runLlmRequest(makeReq(), asRes(res), okMessages, "c-abort");
    await vi.waitFor(() => {
      expect(res.body).toContain("token");
    });
    expect(captured?.aborted).toBe(false);
    res.emit("close");
    expect(captured?.aborted).toBe(true);
    releaseHang();
    await pending;
  });

  // ----------------------------------------------------------------------------
  // T-CH-01: hard timeout state machine + tool_choice pass-through + contract fixture
  // ----------------------------------------------------------------------------

  beforeEach(() => {
    // 恢复默认 90s 以防前一个测试覆盖未清
    setLlmStreamMaxDurationMs(90_000);
  });
  describe("runLlmRequest — T-CH-01 hard timeout (4 scenarios + reverse + upstream cancel)", () => {
    // fake 上游必须观察 abort signal，否则 for-await 永不退出，runLlmRequest 不会 resolve。
    // 这与生产里 OpenAI SDK 真实行为一致：abort → stream throw。
    function hangUntilAbort() {
      const releaseRef: { current?: () => void } = {};
      // eslint-disable-next-line require-yield -- scenario A 要求上游不 yield 任何字节
      mocks.chatStream.mockImplementation(async function* (
        r: ChatStreamRequest
      ) {
        if (r.signal?.aborted) return;
        await new Promise<void>((resolve) => {
          if (r.signal) {
            const onAbort = () => {
              r.signal!.removeEventListener("abort", onAbort);
              resolve();
            };
            r.signal.addEventListener("abort", onAbort);
          }
          releaseRef.current = () => {
            if (r.signal) r.signal.removeEventListener("abort", () => {});
            resolve();
          };
        });
      });
      return {
        release: () => {
          releaseRef.current?.();
        }
      };
    }

    it("scenario A: times out BEFORE writing any bytes → 500 COPILOT_LLM_HARD_TIMEOUT JSON", async () => {
      setLlmStreamMaxDurationMs(20);
      hangUntilAbort();
      const res = makeRes();
      await runLlmRequest(makeReq(), asRes(res), okMessages, "c-A");
      expect(res.statusCode).toBe(500);
      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.body).toContain("COPILOT_LLM_HARD_TIMEOUT");
      expect(res.body).not.toContain('"type":"token"');
      expect(res.writableEnded).toBe(true);
    });

    it("scenario B: times out AFTER partial bytes → SSE error frame COPILOT_LLM_HARD_TIMEOUT", async () => {
      setLlmStreamMaxDurationMs(20);
      mocks.chatStream.mockImplementation(async function* (
        req: ChatStreamRequest
      ) {
        yield { type: "token", data: "partial" } satisfies ChatStreamDelta;
        await new Promise<void>((resolve) => {
          if (req.signal) {
            const onAbort = () => {
              req.signal!.removeEventListener("abort", onAbort);
              resolve();
            };
            req.signal.addEventListener("abort", onAbort);
          }
        });
      });
      const res = makeRes();
      await runLlmRequest(makeReq(), asRes(res), okMessages, "c-B");
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(
        JSON.stringify({ type: "token", data: "partial" })
      );
      expect(res.body).toContain(
        JSON.stringify({
          type: "error",
          data: { code: "COPILOT_LLM_HARD_TIMEOUT" }
        })
      );
      expect(res.writableEnded).toBe(true);
    });

    it("scenario C: client closes response during hard-timeout window → no write-after-end", async () => {
      setLlmStreamMaxDurationMs(20);
      hangUntilAbort();
      const res = makeRes();
      const pending = runLlmRequest(makeReq(), asRes(res), okMessages, "c-C");
      // Wait until abort handler is registered then emit close
      await new Promise((r) => setImmediate(r));
      res.emit("close");
      await pending;
      expect(res.writableEnded).toBe(true);
    });

    it("scenario D: stream completes WELL before hard timeout → no spurious fail()", async () => {
      setLlmStreamMaxDurationMs(10_000);
      mocks.chatStream.mockImplementation(async function* (
        _req: ChatStreamRequest
      ) {
        yield { type: "token", data: "fast" } satisfies ChatStreamDelta;
      });
      const res = makeRes();
      await runLlmRequest(makeReq(), asRes(res), okMessages, "c-D");
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(
        JSON.stringify({ type: "token", data: "fast" })
      );
      expect(res.body).not.toContain("COPILOT_LLM_HARD_TIMEOUT");
      expect(res.writableEnded).toBe(true);
    });

    it("reverse: stream that ends slightly before the deadline is NOT misclassified as timeout", async () => {
      setLlmStreamMaxDurationMs(100);
      mocks.chatStream.mockImplementation(async function* (
        _req: ChatStreamRequest
      ) {
        // 直接 yield 第一个 token，模拟正常完成
        yield { type: "token", data: "ok" } satisfies ChatStreamDelta;
      });
      const res = makeRes();
      await runLlmRequest(makeReq(), asRes(res), okMessages, "c-R");
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(JSON.stringify({ type: "token", data: "ok" }));
      expect(res.body).not.toContain("COPILOT_LLM_HARD_TIMEOUT");
    });

    it("upstream cancel: hard timeout triggers ac.abort() — no bytes are written after", async () => {
      setLlmStreamMaxDurationMs(20);
      let captured: AbortSignal | undefined;
      mocks.chatStream.mockImplementation(async function* (
        req: ChatStreamRequest
      ) {
        captured = req.signal;
        yield { type: "token", data: "first" } satisfies ChatStreamDelta;
        await new Promise<void>((resolve) => {
          if (req.signal) {
            const onAbort = () => {
              req.signal!.removeEventListener("abort", onAbort);
              resolve();
            };
            req.signal.addEventListener("abort", onAbort);
          }
        });
      });
      const res = makeRes();
      await runLlmRequest(makeReq(), asRes(res), okMessages, "c-U");
      expect(captured?.aborted).toBe(true);
      expect(res.body).toContain(
        JSON.stringify({
          type: "error",
          data: { code: "COPILOT_LLM_HARD_TIMEOUT" }
        })
      );
      expect(res.body).not.toContain(
        JSON.stringify({ type: "token", data: "second" })
      );
    });
  });

  describe("runLlmRequest — T-CH-01 tool_choice pass-through + contract fixture", () => {
    it("forwards tool_choice (named-function) to chatStream()", async () => {
      let captured: ChatStreamRequest | undefined;
      mocks.chatStream.mockImplementation((req: ChatStreamRequest) => {
        captured = req;
        return streamOf({ type: "token", data: "x" }, { type: "done" });
      });
      const res = makeRes();
      await runLlmRequest(
        makeReq(),
        asRes(res),
        {
          messages: [{ role: "user", content: "compress this" }],
          tools: [
            {
              type: "function",
              function: {
                name: "generate_structured_output",
                description: "comp",
                parameters: { type: "object" }
              }
            }
          ],
          tool_choice: {
            type: "function",
            function: { name: "generate_structured_output" }
          },
          temperature: 0.2
        },
        "c-tc"
      );
      expect(captured?.tool_choice).toEqual({
        type: "function",
        function: { name: "generate_structured_output" }
      });
      expect(captured?.tools).toHaveLength(1);
    });

    it("omits tool_choice from chatStream() when caller does not set it", async () => {
      let captured: ChatStreamRequest | undefined;
      mocks.chatStream.mockImplementation((req: ChatStreamRequest) => {
        captured = req;
        return streamOf({ type: "token", data: "x" }, { type: "done" });
      });
      await runLlmRequest(makeReq(), asRes(makeRes()), okMessages, "c-tc2");
      expect(captured?.tool_choice).toBeUndefined();
    });

    it("rejects invalid tool_choice type with 400 INVALID_TOOL_CHOICE", async () => {
      const res = makeRes();
      await runLlmRequest(
        makeReq(),
        asRes(res),
        {
          messages: [{ role: "user", content: "hi" }],
          tool_choice: 42
        },
        "c-tc3"
      );
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain("INVALID_TOOL_CHOICE");
    });

    it("contract fixture: compression_payload.json passes validateLlmBody and is forwarded verbatim", async () => {
      const fixturePath = resolve(
        __dirname,
        "../../../../../apps/copilot/tests/fixtures/compression_payload.json"
      );
      const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as Record<
        string,
        unknown
      >;
      let captured: ChatStreamRequest | undefined;
      mocks.chatStream.mockImplementation((req: ChatStreamRequest) => {
        captured = req;
        return streamOf(
          {
            type: "tool_call",
            data: {
              id: "call_1",
              name: "generate_structured_output",
              arguments: '{"summary":"x","key_points":["y"]}'
            }
          },
          { type: "done" }
        );
      });
      const res = makeRes();
      await runLlmRequest(makeReq(), asRes(res), fixture, "c-fixture");
      expect(res.statusCode).toBe(200);
      expect(captured?.tool_choice).toEqual(fixture.tool_choice);
      expect(captured?.tools).toEqual(fixture.tools);
    });
  });
});
