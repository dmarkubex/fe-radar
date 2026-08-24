/**
 * T-CA-05 / design §3.2: `POST /internal/llm` SSE 流式 handler。
 *
 * - 鉴权由 `http-server.ts` 统一做（缺/空 token → 401），本层不再重复。
 * - 先 `await loadProjectCodes()`（fail-closed）；从未成功且尚未写字节 → 422 SCRUBBER_FAILED。
 * - 公网只走 `withScrubber(handlerContext.deepSeek, { projectCodes }).chatStream`。
 * - Abort：**只**听 `res.close`；禁止 `req.on("close")`（Node 22 表示请求体结束）。
 *
 * T-CH-01:
 * - `tool_choice` 透传：agentscope 上下文压缩触发的合成 `generate_structured_output` 工具选择，
 *   `validateLlmBody` 接受并原样转发到 `chatStream({ tool_choice })`。
 * - 单次生成总时长硬上限：环境变量 `LLM_STREAM_MAX_DURATION_MS`（默认 90000ms = 90s）。
 *   90s 是无生产时延数据先验值（既有 SDK 60s 是"两次数据块间隔"语义，不约束总时长），
 *   与 copilot 侧 `TURN_TIMEOUT_SEC=120` 是两道独立防线（响应生命 vs 单次调用），不嵌套。
 *   触发时通过既有 `AbortController` (`ac.abort()`) 中止上游 HTTP 连接，
 *   并写 `COPILOT_LLM_HARD_TIMEOUT` 错误帧；正常结束或客户端断连会清理该计时器。
 * - 一次性 terminal 状态迁移：`finished` 闸门变量保证计时器/上游 abort/客户端断连三者
 *   中较晚到达者只能触发一次 `fail()` / `end()`，杜绝 write-after-end。
 */
import type http from "node:http";
import { createLogger, LlmError } from "@fe-radar/shared";
import { withScrubber, LLM_HARD_TIMEOUT_CODE } from "@fe-radar/llm";
import type {
  ChatMessage,
  ChatToolDef,
  ChatToolChoiceParam
} from "@fe-radar/llm";
import { handlerContext, loadProjectCodes } from "../handlers/context";

const logger = createLogger({ service: "copilot-llm" });

/** T-CH-01: 单次生成总时长硬上限默认 90s（与 copilot `TURN_TIMEOUT_SEC=120` 是两道独立防线）。 */
const DEFAULT_LLM_STREAM_MAX_DURATION_MS = 90_000;
// T-CH-01: 硬上限错误码 `LLM_HARD_TIMEOUT_CODE` 从 @fe-radar/llm 导入（单一来源，
// 与 SCRUBBER_BLOCKED 等通道错误码同源），Python 侧用同一字面量解析。

/** 仅供测试注入：worker 单测可设置更小的硬上限以缩短跑测时间。生产路径仍读 env / 默认值。 */
let llmStreamMaxDurationMsOverride: number | null = null;
export function setLlmStreamMaxDurationMs(ms: number): void {
  llmStreamMaxDurationMsOverride = ms;
}
function readHardDeadlineMs(): number {
  if (llmStreamMaxDurationMsOverride !== null)
    return llmStreamMaxDurationMsOverride;
  const fromEnv = Number(process.env.LLM_STREAM_MAX_DURATION_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_LLM_STREAM_MAX_DURATION_MS;
}

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
  // T-CH-01: `finished` 闸门须在 close handler 注册之前声明（避免闭包 TDZ）。
  // 任意路径完成或失败后置 true，fail()/end() 内部再次短路。
  // 计时器 / 上游 abort / 客户端断连三者中较晚到达者只能触发一次 terminal 写入。
  let finished = false;
  res.on("close", () => {
    if (!res.writableEnded) {
      finished = true;
      ac.abort();
    }
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
    if (finished || res.writableEnded) return;
    finished = true;
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
    logger.error(
      { err, correlationId },
      "loadProjectCodes failed; blocking public LLM"
    );
    fail(422, "SCRUBBER_FAILED");
    return;
  }

  // T-CH-01: 单次生成总时长硬上限。计时器到点 → 中止连接 + 写错误帧。
  // 任意终点（正常 / fail / 客户端断连）必须 clearTimeout，防止悬挂 timer handle。
  const hardTimer = setTimeout(() => {
    ac.abort();
    fail(500, LLM_HARD_TIMEOUT_CODE);
  }, readHardDeadlineMs());

  try {
    const stream = withScrubber(handlerContext.deepSeek, {
      projectCodes
    }).chatStream({
      messages: validation.messages,
      tools: validation.tools,
      ...(validation.tool_choice !== undefined
        ? { tool_choice: validation.tool_choice }
        : {}),
      temperature: validation.temperature,
      signal: ac.signal
    });
    for await (const delta of stream) {
      if (ac.signal.aborted) break;
      writeSse(delta);
    }
    if (!finished && !res.writableEnded) {
      finished = true;
      res.end();
    }
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
  } finally {
    clearTimeout(hardTimer);
  }
}

function validateLlmBody(body: unknown):
  | {
      ok: true;
      messages: ChatMessage[];
      tools?: ChatToolDef[];
      tool_choice?: ChatToolChoiceParam;
      temperature?: number;
    }
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
  if (
    obj.tool_choice !== undefined &&
    typeof obj.tool_choice !== "string" &&
    typeof obj.tool_choice !== "object"
  ) {
    return { ok: false, errorCode: "INVALID_TOOL_CHOICE" };
  }
  if (obj.temperature !== undefined && typeof obj.temperature !== "number") {
    return { ok: false, errorCode: "INVALID_TEMPERATURE" };
  }
  return {
    ok: true,
    messages: obj.messages as ChatMessage[],
    tools: obj.tools as ChatToolDef[] | undefined,
    tool_choice: obj.tool_choice as ChatToolChoiceParam | undefined,
    temperature: obj.temperature as number | undefined
  };
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown
): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function isUpstreamTimeout(err: unknown): boolean {
  if (err instanceof LlmError && /timeout/i.test(err.code)) return true;
  if (!(err instanceof Error)) return false;
  if (err.name === "APIConnectionTimeoutError" || err.name === "TimeoutError")
    return true;
  return /timed?\s*out/i.test(err.message);
}
