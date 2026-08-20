/**
 * T-CA-05 / design §3.2: `POST /internal/llm` SSE 流式 handler。
 *
 * - 鉴权由 `http-server.ts` 统一做（缺/空 token → 401），本层不再重复。
 * - 先 `await loadProjectCodes()`（fail-closed）；从未成功且尚未写字节 → 422 SCRUBBER_FAILED。
 * - 公网只走 `withScrubber(handlerContext.deepSeek, { projectCodes }).chatStream`。
 * - Abort：**只**听 `res.close`；禁止 `req.on("close")`（Node 22 表示请求体结束）。
 */
import type http from "node:http";
import { createLogger, LlmError } from "@fe-radar/shared";
import { withScrubber } from "@fe-radar/llm";
import type { ChatMessage, ChatToolDef } from "@fe-radar/llm";

import { handlerContext, loadProjectCodes } from "../handlers/context";

const logger = createLogger({ service: "copilot-llm" });

export async function runLlmRequest(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  body: unknown,
  correlationId: string
): Promise<void> {
  const validation = validateLlmBody(body);
  if (!validation.ok) {
    sendJson(res, 400, { error: { code: validation.errorCode } });
    return;
  }

  const ac = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) ac.abort();
  });

  let wroteBytes = false;
  const writeSse = (payload: unknown): void => {
    if (res.writableEnded) return;
    if (!wroteBytes) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
    }
    wroteBytes = true;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const fail = (status: number, code: string): void => {
    if (res.writableEnded) return;
    if (!wroteBytes) {
      sendJson(res, status, { error: { code } });
      return;
    }
    writeSse({ type: "error", data: { code } });
    res.end();
  };

  let projectCodes: string[];
  try {
    projectCodes = await loadProjectCodes();
  } catch (err) {
    logger.error({ err, correlationId }, "loadProjectCodes failed; blocking public LLM");
    fail(422, "SCRUBBER_FAILED");
    return;
  }

  try {
    const stream = withScrubber(handlerContext.deepSeek, { projectCodes }).chatStream({
      messages: validation.messages,
      tools: validation.tools,
      temperature: validation.temperature,
      signal: ac.signal
    });
    for await (const delta of stream) {
      if (ac.signal.aborted) break;
      writeSse(delta);
    }
    if (!res.writableEnded) res.end();
  } catch (err) {
    if (ac.signal.aborted || res.writableEnded) {
      return;
    }
    if (err instanceof LlmError && err.code === "SCRUBBER_BLOCKED") {
      fail(422, "SCRUBBER_BLOCKED");
      return;
    }
    if (err instanceof LlmError && err.code === "SCRUBBER_FAILED") {
      fail(422, "SCRUBBER_FAILED");
      return;
    }
    if (isUpstreamTimeout(err)) {
      fail(502, "COPILOT_UPSTREAM_TIMEOUT");
      return;
    }
    logger.error({ err, correlationId }, "internal llm stream failed");
    fail(500, "INTERNAL");
  }
}

function validateLlmBody(body: unknown):
  | { ok: true; messages: ChatMessage[]; tools?: ChatToolDef[]; temperature?: number }
  | { ok: false; errorCode: string } {
  if (body === null || typeof body !== "object") {
    return { ok: false, errorCode: "INVALID_BODY" };
  }
  const obj = body as Record<string, unknown>;
  if ("url" in obj || "href" in obj) {
    return { ok: false, errorCode: "LLM_URL_FORBIDDEN" };
  }
  if (!Array.isArray(obj.messages)) {
    return { ok: false, errorCode: "INVALID_MESSAGES" };
  }
  if (obj.tools !== undefined && !Array.isArray(obj.tools)) {
    return { ok: false, errorCode: "INVALID_TOOLS" };
  }
  if (obj.temperature !== undefined && typeof obj.temperature !== "number") {
    return { ok: false, errorCode: "INVALID_TEMPERATURE" };
  }
  return {
    ok: true,
    messages: obj.messages as ChatMessage[],
    tools: obj.tools as ChatToolDef[] | undefined,
    temperature: obj.temperature as number | undefined
  };
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function isUpstreamTimeout(err: unknown): boolean {
  if (err instanceof LlmError && /timeout/i.test(err.code)) return true;
  if (!(err instanceof Error)) return false;
  if (err.name === "APIConnectionTimeoutError" || err.name === "TimeoutError") return true;
  return /timed?\s*out/i.test(err.message);
}
