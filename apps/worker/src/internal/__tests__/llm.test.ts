import { EventEmitter } from "node:events";
import type http from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LlmError } from "@fe-radar/shared";
import type { ChatStreamDelta, ChatStreamRequest, LlmClient } from "@fe-radar/llm";
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

import { runLlmRequest } from "../llm";

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

async function* streamOf(...deltas: ChatStreamDelta[]): AsyncIterable<ChatStreamDelta> {
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
    await runLlmRequest(makeReq(), asRes(res), { ...okMessages, url: "https://x" }, "c-1");
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
    const streamed = mocks.chatStream.mock.calls[0]?.[0] as ChatStreamRequest | undefined;
    expect(streamed?.signal?.aborted).toBe(false);
    expect(reqOn).not.toHaveBeenCalledWith("close", expect.any(Function));
    expect(mocks.withScrubber).toHaveBeenCalledWith(mocks.deepSeek, { projectCodes: ["ABCD"] });
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
    expect(res.body).toContain(`data: ${JSON.stringify({ type: "token", data: "partial" })}`);
    expect(res.body).toContain(
      `data: ${JSON.stringify({ type: "error", data: { code: "COPILOT_UPSTREAM_TIMEOUT" } })}`
    );
  });

  it("aborts the upstream signal when the client closes the response mid-stream", async () => {
    let captured: AbortSignal | undefined;
    let releaseHang: (() => void) | undefined;
    const hang = new Promise<void>((resolve) => {
      releaseHang = resolve;
    });
    mocks.chatStream.mockImplementation(async function* (req: ChatStreamRequest) {
      captured = req.signal;
      yield { type: "token", data: "x" } satisfies ChatStreamDelta;
      await hang;
    });

    const res = makeRes();
    const pending = runLlmRequest(makeReq(), asRes(res), okMessages, "c-abort");
    await vi.waitFor(() => {
      expect(res.body).toContain("token");
    });
    expect(captured?.aborted).toBe(false);
    res.emit("close");
    expect(captured?.aborted).toBe(true);
    releaseHang?.();
    await pending;
  });
});
