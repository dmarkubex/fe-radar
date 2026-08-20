import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NextRequest } from "next/server";
import type * as CopilotProxy from "../../proxy";

const { mockRequireFreshRole, mockGetRequestUser, mockEvaluate, mockProxy } = vi.hoisted(() => ({
  mockRequireFreshRole: vi.fn<(req: NextRequest, role: string) => Promise<Response | null>>(),
  mockGetRequestUser: vi.fn<() => Promise<{ id?: number; role?: string }>>(),
  mockEvaluate: vi.fn<(userId: number) => Promise<boolean>>(),
  mockProxy: vi.fn()
}));

vi.mock("@/lib/api/authz", () => ({
  requireFreshRole: mockRequireFreshRole,
  getRequestUser: mockGetRequestUser,
  unauthorized: () =>
    Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 })
}));

vi.mock("@/lib/api/copilot-access", () => ({
  evaluateCopilotAccess: mockEvaluate,
  copilotDisabled: () =>
    Response.json(
      { error: { code: "COPILOT_DISABLED", message: "Copilot 未对当前账号开放" } },
      { status: 403 }
    )
}));

vi.mock("@/lib/logger", () => ({
  webLogger: { error: vi.fn() }
}));

vi.mock("../../proxy", async () => {
  const actual = await vi.importActual<typeof CopilotProxy>("../../proxy");
  return {
    ...actual,
    proxyToCopilot: mockProxy
  };
});

import { GET, POST } from "../route";
import { COPILOT_DISCLAIMER } from "../../proxy";

const actualProxy = await vi.importActual<typeof CopilotProxy>("../../proxy");

function makeRequest(
  url: string,
  init?: RequestInit
): NextRequest {
  const request = new Request(url, init) as NextRequest;
  Object.defineProperty(request, "nextUrl", { value: new URL(url) });
  return request;
}

function params(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

describe("copilot catch-all BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireFreshRole.mockResolvedValue(null);
    mockGetRequestUser.mockResolvedValue({ id: 1, role: "viewer" });
    mockEvaluate.mockResolvedValue(true);
    mockProxy.mockResolvedValue(Response.json({ sessions: [] }));
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 404 for paths outside the whitelist (including /access)", async () => {
    const res = await GET(makeRequest("http://localhost/api/copilot/access"), params(["access"]));
    expect(res.status).toBe(404);
    expect(mockProxy).not.toHaveBeenCalled();
  });

  it("returns 403 COPILOT_DISABLED when grayscale is off", async () => {
    mockEvaluate.mockResolvedValue(false);
    const res = await POST(
      makeRequest("http://localhost/api/copilot/chat", {
        method: "POST",
        body: JSON.stringify({ message: "hi" })
      }),
      params(["chat"])
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "COPILOT_DISABLED" } });
    expect(mockProxy).not.toHaveBeenCalled();
  });

  it("returns 413 before HMAC when POST body exceeds 32KiB", async () => {
    const raw = `{"message":"${"x".repeat(33000)}"}`;
    const res = await POST(
      makeRequest("http://localhost/api/copilot/chat", { method: "POST", body: raw }),
      params(["chat"])
    );
    expect(res.status).toBe(413);
    expect(mockProxy).not.toHaveBeenCalled();
  });

  it("stubs only non-production POST /chat", async () => {
    vi.stubEnv("E2E_COPILOT_STUB", "1");
    vi.stubEnv("NODE_ENV", "test");
    const res = await POST(
      makeRequest("http://localhost/api/copilot/chat", {
        method: "POST",
        body: JSON.stringify({ message: "hi" })
      }),
      params(["chat"])
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("数据截止");
    expect(text).toContain(COPILOT_DISCLAIMER);
    expect(text).toContain("_ack");
    expect(text).toContain("assistantMessageId");
    expect(mockProxy).not.toHaveBeenCalled();
  });

  it("never stubs sessions", async () => {
    vi.stubEnv("E2E_COPILOT_STUB", "1");
    vi.stubEnv("NODE_ENV", "test");
    const res = await GET(makeRequest("http://localhost/api/copilot/sessions"), params(["sessions"]));
    expect(res.status).toBe(200);
    expect(mockProxy).toHaveBeenCalled();
  });

  it("fail-closes stub in production", async () => {
    vi.stubEnv("E2E_COPILOT_STUB", "1");
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(
      makeRequest("http://localhost/api/copilot/chat", {
        method: "POST",
        body: JSON.stringify({ message: "hi" })
      }),
      params(["chat"])
    );
    expect(res.status).toBe(500);
    expect(mockProxy).not.toHaveBeenCalled();
  });
});

describe("proxyToCopilot abort (no AbortSignal.timeout)", () => {
  it("returns 502 COPILOT_UPSTREAM_TIMEOUT when the upstream never sends headers", async () => {
    const hangingFetch: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });

    const request = new Request("http://localhost/api/copilot/chat", {
      method: "POST",
      body: "{}"
    });
    const res = await actualProxy.proxyToCopilot({
      request,
      method: "POST",
      path: "/chat",
      raw: "{}",
      userId: 1,
      role: "viewer",
      fetchImpl: hangingFetch,
      headerTimeoutMs: 20,
      secret: "secret"
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: "COPILOT_UPSTREAM_TIMEOUT" } });
  });

  it("passes through a non-2xx upstream status and JSON", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: "COPILOT_TURN_IN_PROGRESS" } }), {
        status: 409,
        headers: { "content-type": "application/json" }
      });
    const request = new Request("http://localhost/api/copilot/chat", { method: "POST", body: "{}" });
    const res = await actualProxy.proxyToCopilot({
      request,
      method: "POST",
      path: "/chat",
      raw: "{}",
      userId: 1,
      role: "viewer",
      fetchImpl,
      secret: "secret"
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "COPILOT_TURN_IN_PROGRESS" } });
  });

  it("does not use AbortSignal.timeout", async () => {
    expect(actualProxy.COPILOT_HEADER_TIMEOUT_MS).toBe(10_000);
    const fs = await import("node:fs");
    const text = fs.readFileSync(new URL("../../proxy.ts", import.meta.url), "utf8");
    expect(text).not.toContain("AbortSignal.timeout");
  });
});
