/**
 * T-CA-05 / design §3.4 worker 内网 HTTP（`node:http` 单 server）。
 *
 * 路由：
 * - `POST /internal/fulltext` —— 见 `fulltext.ts`，鉴权同下。
 * - `POST /internal/llm` —— 见 `llm.ts`，鉴权同下。
 * - 其它任何路径 → 404。
 *
 * 鉴权：启动读 `SERVICE_TOKEN_WORKER_FILE`（缺 / trim 空 → 启动 warn，
 * **所有** `/internal/*` 一律 401）。Bearer token 比对（常量时间）。
 *
 * 故障隔离（NFR-307）：
 * - `server.listen` 失败 log.error 但不 `process.exit`，BullMQ Worker 继续。
 * - 每个 handler 最外层 try/catch，抛错 → 500，进程继续。
 * - shutdown：从未 listen 成功 → 跳过 `server.close`。
 *   `server.close` 必须包 Promise 并 race 5s；随后 `closeAllConnections`。
 *   **不**在这里停 heartbeat（只由 bootstrap `createWorkerRuntime.onShutdown` 停一次）。
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

import { createLogger } from "@fe-radar/shared";

import { runFulltextRequest } from "./fulltext";
import { runLlmRequest } from "./llm";

const logger = createLogger({ service: "copilot-http" });

export type ServiceTokenLoader = () => Promise<string | null>;

export interface HttpServerOptions {
  /** 注入 token 来源；默认读 `SERVICE_TOKEN_WORKER_FILE`。 */
  loadToken?: ServiceTokenLoader;
  /** 进程退出协调钩子（shutdown 完成后触发；测试用）。 */
  onStopped?: () => void | Promise<void>;
}

export interface HttpServerHandle {
  /** 已经成功 listen 时返回 server，便于测试断言。 */
  server: http.Server | null;
  /** listen 状态：true=成功绑定端口，false=失败。 */
  bound: boolean;
  shutdown(signal: string): Promise<void>;
}

const DEFAULT_PORT = 8071;
const SHUTDOWN_GRACE_MS = 5000;

/**
 * 启动内网 HTTP 服务。
 *
 * - listen 失败 → log.error，**不**抛错（设计 NFR-307），handle.bound=false。
 * - 返回 handle，shutdown 在从未成功 listen 时跳过 server.close。
 */
export async function startInternalHttpServer(
  options: HttpServerOptions = {}
): Promise<HttpServerHandle> {
  const token = await loadToken(options.loadToken);
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, token).catch((err: unknown) => {
      logger.error({ err }, "internal http request escaped handler");
      try {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
        }
        res.end(JSON.stringify({ error: { code: "INTERNAL" } }));
      } catch {
        // swallow — process must keep running
      }
    });
  });

  // listen 失败不 process.exit：log.error，BullMQ Worker 继续。
  const port = Number(process.env.WORKER_INTERNAL_BIND ?? DEFAULT_PORT);
  let bound = false;
  await new Promise<void>((resolve) => {
    server.once("error", (err: Error) => {
      logger.error({ err, port }, "internal http listen failed; bullmq keeps running");
      resolve();
    });
    try {
      server.listen(port, "0.0.0.0", () => {
        bound = true;
        const addr = server.address();
        logger.info({ addr }, "internal http listening");
        resolve();
      });
    } catch (err) {
      // Number('not-a-port') 是 NaN，listen 同步抛 ERR_SOCKET_BAD_PORT
      logger.error({ err, port }, "internal http listen failed; bullmq keeps running");
      resolve();
    }
  });

  let shutdownPromise: Promise<void> | null = null;
  return {
    server: bound ? server : null,
    bound,
    shutdown(signal: string): Promise<void> {
      shutdownPromise ??= (async () => {
        logger.info({ signal }, "shutting down internal http");
        if (bound && server.listening) {
          await Promise.race([
            new Promise<void>((res, rej) =>
              server.close((err) => (err ? rej(err) : res()))
            ),
            new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS))
          ]);
          server.closeAllConnections?.();
        }
        await options.onStopped?.();
      })();
      return shutdownPromise;
    }
  };
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string | null
): Promise<void> {
  try {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED" } });
      return;
    }
    if (!isInternalPath(req.url ?? "")) {
      sendJson(res, 404, { error: { code: "NOT_FOUND" } });
      return;
    }
    if (token === null) {
      sendJson(res, 401, { error: { code: "AUTH_REQUIRED" } });
      return;
    }
    if (!checkBearer(req.headers.authorization, token)) {
      sendJson(res, 401, { error: { code: "UNAUTHORIZED" } });
      return;
    }

    if (req.url === "/internal/fulltext") {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendJson(res, 400, { error: { code: body.errorCode } });
        return;
      }
      const correlationId = headerString(req.headers["x-fer-correlation-id"]) ?? randomUUID();
      await runFulltextRequest(req, res, body.value, correlationId);
      return;
    }
    if (req.url === "/internal/llm") {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendJson(res, 400, { error: { code: body.errorCode } });
        return;
      }
      const correlationId = headerString(req.headers["x-fer-correlation-id"]) ?? randomUUID();
      await runLlmRequest(req, res, body.value, correlationId);
      return;
    }
    sendJson(res, 404, { error: { code: "NOT_FOUND" } });
  } catch (err) {
    logger.error({ err }, "internal http handler error");
    if (!res.headersSent) {
      sendJson(res, 500, { error: { code: "INTERNAL" } });
    } else {
      res.end();
    }
  }
}

function isInternalPath(url: string): boolean {
  return url === "/internal/fulltext" || url === "/internal/llm";
}

/** 常量时间 Bearer 比较（防 timing leak）。 */
function checkBearer(headerValue: string | string[] | undefined, token: string): boolean {
  if (typeof headerValue !== "string") return false;
  const expected = `Bearer ${token}`;
  if (headerValue.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= headerValue.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
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

function headerString(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") return value[0];
  return undefined;
}

type BodyResult =
  | { ok: true; value: unknown }
  | { ok: false; errorCode: string };

async function readJsonBody(req: http.IncomingMessage): Promise<BodyResult> {
  const chunks: Buffer[] = [];
  let total = 0;
  const MAX = 1_000_000; // 1 MiB；chat history 可能较大，但有上限
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX) {
      return { ok: false, errorCode: "BODY_TOO_LARGE" };
    }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) return { ok: false, errorCode: "EMPTY_BODY" };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, errorCode: "INVALID_JSON" };
  }
}

async function loadToken(override?: ServiceTokenLoader): Promise<string | null> {
  if (override) return override();
  const filePath = process.env.SERVICE_TOKEN_WORKER_FILE;
  if (!filePath) {
    logger.warn("SERVICE_TOKEN_WORKER_FILE not set; all /internal/* will 401");
    return null;
  }
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      logger.warn({ filePath }, "SERVICE_TOKEN_WORKER_FILE empty; all /internal/* will 401");
      return null;
    }
    return trimmed;
  } catch (err) {
    logger.warn({ err, filePath }, "failed to read SERVICE_TOKEN_WORKER_FILE; all /internal/* will 401");
    return null;
  }
}

export const __testing = {
  checkBearer,
  loadToken,
  readJsonBody
};