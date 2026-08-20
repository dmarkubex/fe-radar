import { buildCopilotAuthHeaders, readCopilotInternalSecret } from "./hmac";

import type { UserRole } from "@fe-radar/shared";

export const COPILOT_BODY_LIMIT = 32768;
export const COPILOT_HEADER_TIMEOUT_MS = 10_000;
export const COPILOT_DISCLAIMER = "模型观点，仅供参考，不构成采购/交易建议";

const SESSION_MESSAGES = /^\/sessions\/\d+\/messages$/;
const MESSAGE_FEEDBACK = /^\/messages\/\d+\/feedback$/;

export function isWhitelistedCopilotPath(method: string, path: string): boolean {
  if (method === "POST" && path === "/chat") return true;
  if (method === "GET" && path === "/sessions") return true;
  if (method === "GET" && SESSION_MESSAGES.test(path)) return true;
  if (method === "POST" && MESSAGE_FEEDBACK.test(path)) return true;
  return false;
}

export function copilotUpstreamUrl(path: string): string {
  const base = (process.env.COPILOT_UPSTREAM_URL ?? "http://copilot:8000").replace(/\/$/, "");
  return `${base}${path}`;
}

export function stubChatSse(): Response {
  const body = [
    `data: ${JSON.stringify({ type: "tool", data: { name: "_ack", sessionId: 1 } })}`,
    `data: ${JSON.stringify({ type: "token", data: `数据截止至 stub。${COPILOT_DISCLAIMER}` })}`,
    `data: ${JSON.stringify({ type: "done", data: { sessionId: 1, assistantMessageId: 1 } })}`,
    ""
  ].join("\n\n");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache"
    }
  });
}

export function maybeStubChat(method: string, path: string): Response | null {
  if (process.env.E2E_COPILOT_STUB !== "1") return null;
  if (process.env.NODE_ENV === "production") {
    return Response.json(
      { error: { code: "COPILOT_STUB_FORBIDDEN", message: "生产环境禁止 Copilot stub" } },
      { status: 500 }
    );
  }
  if (method === "POST" && path === "/chat") {
    return stubChatSse();
  }
  return null;
}

function pipeUpstream(
  upstream: Response,
  ac: AbortController
): ReadableStream<Uint8Array> | null {
  if (!upstream.body) return null;
  const reader = upstream.body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        ac.abort();
        controller.error(err);
      }
    },
    cancel() {
      ac.abort();
      return reader.cancel();
    }
  });
}

export async function proxyToCopilot(input: {
  request: Request;
  method: string;
  path: string;
  raw: string;
  userId: number;
  role: UserRole;
  fetchImpl?: typeof fetch;
  headerTimeoutMs?: number;
  secret?: string;
}): Promise<Response> {
  const secret = input.secret ?? readCopilotInternalSecret();
  const headers = {
    "content-type": "application/json",
    ...buildCopilotAuthHeaders({
      method: input.method,
      path: input.path,
      body: input.raw,
      userId: input.userId,
      role: input.role,
      secret
    })
  };

  const ac = new AbortController();
  if (input.request.signal.aborted) ac.abort();
  input.request.signal.addEventListener("abort", () => ac.abort());
  const timer = setTimeout(() => ac.abort(), input.headerTimeoutMs ?? COPILOT_HEADER_TIMEOUT_MS);
  const fetchImpl = input.fetchImpl ?? fetch;

  let upstream: Response;
  try {
    upstream = await fetchImpl(copilotUpstreamUrl(input.path), {
      signal: ac.signal,
      headers,
      body: input.method === "GET" ? undefined : input.raw,
      method: input.method
    });
  } catch {
    clearTimeout(timer);
    return Response.json(
      { error: { code: "COPILOT_UPSTREAM_TIMEOUT", message: "Copilot 上游超时" } },
      { status: 502 }
    );
  }
  clearTimeout(timer);

  const contentType = upstream.headers.get("content-type") ?? "application/json";
  return new Response(pipeUpstream(upstream, ac), {
    status: upstream.status,
    headers: { "content-type": contentType }
  });
}
