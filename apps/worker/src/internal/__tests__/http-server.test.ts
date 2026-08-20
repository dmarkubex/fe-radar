import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as FeRadarShared from "@fe-radar/shared";

const mocks = vi.hoisted(() => ({
  runFulltextRequest: vi.fn(),
  runLlmRequest: vi.fn()
}));

vi.mock("../fulltext", () => ({
  runFulltextRequest: mocks.runFulltextRequest
}));

vi.mock("../llm", () => ({
  runLlmRequest: mocks.runLlmRequest
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

import { startInternalHttpServer } from "../http-server";

const TOKEN = "test-token-ca05";

async function postJson(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; text: string }> {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") });
        });
      }
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

function boundPort(server: http.Server): number {
  const addr = server.address();
  if (addr && typeof addr === "object") return addr.port;
  throw new Error("server not bound");
}

describe("startInternalHttpServer", () => {
  const prevBind = process.env.WORKER_INTERNAL_BIND;
  let handle: Awaited<ReturnType<typeof startInternalHttpServer>> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runFulltextRequest.mockResolvedValue(undefined);
    mocks.runLlmRequest.mockResolvedValue(undefined);
    process.env.WORKER_INTERNAL_BIND = "0";
  });

  afterEach(async () => {
    if (handle) {
      await handle.shutdown("test");
      handle = null;
    }
    if (prevBind === undefined) delete process.env.WORKER_INTERNAL_BIND;
    else process.env.WORKER_INTERNAL_BIND = prevBind;
    vi.restoreAllMocks();
  });

  it("returns 401 when token is missing (loader returns null)", async () => {
    handle = await startInternalHttpServer({ loadToken: async () => null });
    expect(handle.bound).toBe(true);
    if (!handle.server) throw new Error("expected bound server");
    const res = await postJson(boundPort(handle.server), "/internal/fulltext", { itemId: 1 });
    expect(res.status).toBe(401);
    expect(res.text).toContain("AUTH_REQUIRED");
    expect(mocks.runFulltextRequest).not.toHaveBeenCalled();
  });

  it("returns 401 when Bearer token mismatches", async () => {
    handle = await startInternalHttpServer({ loadToken: async () => TOKEN });
    if (!handle.server) throw new Error("expected bound server");
    const res = await postJson(
      boundPort(handle.server),
      "/internal/fulltext",
      { itemId: 1 },
      { authorization: "Bearer wrong" }
    );
    expect(res.status).toBe(401);
    expect(res.text).toContain("UNAUTHORIZED");
  });

  it("routes POST /internal/fulltext after valid Bearer", async () => {
    mocks.runFulltextRequest.mockImplementation(async (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
    handle = await startInternalHttpServer({ loadToken: async () => TOKEN });
    if (!handle.server) throw new Error("expected bound server");
    const res = await postJson(
      boundPort(handle.server),
      "/internal/fulltext",
      { itemId: 1 },
      { authorization: `Bearer ${TOKEN}` }
    );
    expect(res.status).toBe(200);
    expect(mocks.runFulltextRequest).toHaveBeenCalledTimes(1);
  });

  it("invalid WORKER_INTERNAL_BIND resolves bound=false without throw", async () => {
    process.env.WORKER_INTERNAL_BIND = "not-a-port";
    handle = await startInternalHttpServer({ loadToken: async () => TOKEN });
    expect(handle.bound).toBe(false);
    expect(handle.server).toBeNull();
  });

  it("listen failure does not call process.exit", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.spyOn(http.Server.prototype, "listen").mockImplementation(function listenFail(
      this: http.Server,
      ..._args: unknown[]
    ) {
      queueMicrotask(() => this.emit("error", Object.assign(new Error("EADDRINUSE"), { code: "EADDRINUSE" })));
      return this;
    });

    handle = await startInternalHttpServer({ loadToken: async () => TOKEN });
    expect(handle.bound).toBe(false);
    expect(handle.server).toBeNull();
    expect(exit).not.toHaveBeenCalled();
    await handle.shutdown("test");
    handle = null;
  });

  it("shutdown closes the server and does not accept a heartbeat.stop option", async () => {
    handle = await startInternalHttpServer({ loadToken: async () => TOKEN });
    expect(handle.bound).toBe(true);
    await handle.shutdown("test");
    const closed = handle.server;
    handle = null;
    expect(closed?.listening).toBe(false);
  });
});
