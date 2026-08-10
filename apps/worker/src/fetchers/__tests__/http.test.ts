import type * as Shared from "@fe-radar/shared";
import type * as Undici from "undici";
import type { LookupFunction } from "node:net";
import { fetch as undiciFetch, Agent, ProxyAgent } from "undici";
import { setInternalAllowlistForTests } from "@fe-radar/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { proxyPool } from "../../lib/proxy-pool";
import { assertRobotsAllowed } from "../../lib/robots";
import { fetchTextWithPolicy } from "../http";

type MockProxyEndpoint = {
  id: string;
  server: string;
  disabled: boolean;
  failCount: number;
};

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  agent: vi.fn(function MockAgent(options?: unknown) {
    return { kind: "agent", options };
  }),
  proxyAgent: vi.fn(function MockProxyAgent(options?: unknown) {
    return { kind: "proxy-agent", options };
  }),
  dnsLookup: vi.fn(),
  acquire: vi.fn<() => MockProxyEndpoint | undefined>(() => undefined),
  release: vi.fn(),
  warn: vi.fn()
}));

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof Undici>();
  return {
    ...actual,
    fetch: mocks.fetch,
    Agent: mocks.agent,
    ProxyAgent: mocks.proxyAgent
  };
});

// T-SEC-12: 连接时 lookup 复验直接调 node:dns；测试注入假解析结果。
// 注意 url-guard 的 dns.promises.lookup 在本文件不会触发（守卫默认 env 关闭，
// SSRF 用例均为 IP 字面量无需 DNS）。
vi.mock("node:dns", () => {
  const lookup = (...args: unknown[]) => mocks.dnsLookup(...args);
  return {
    default: { lookup },
    lookup
  };
});

vi.mock("@fe-radar/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof Shared>();
  return {
    ...actual,
    createLogger: vi.fn(() => ({ warn: mocks.warn }))
  };
});

vi.mock("../../lib/proxy-pool", () => ({
  proxyPool: {
    acquire: mocks.acquire,
    release: mocks.release
  }
}));

vi.mock("../../lib/ua-pool", () => ({
  acquireUserAgent: vi.fn(() => "test-agent")
}));

vi.mock("../../lib/robots", () => ({
  assertRobotsAllowed: vi.fn().mockResolvedValue(undefined)
}));

const mockFetch = vi.mocked(undiciFetch);
const mockAgent = vi.mocked(Agent);
const mockProxyAgent = vi.mocked(ProxyAgent);
const mockProxyPool = vi.mocked(proxyPool);
const mockAssertRobotsAllowed = vi.mocked(assertRobotsAllowed);

type CapturedFetchInit = RequestInit & { dispatcher?: unknown };

function textResponse(body: string): Awaited<ReturnType<typeof undiciFetch>> {
  return new Response(body) as unknown as Awaited<
    ReturnType<typeof undiciFetch>
  >;
}

async function fetchOk(
  options: { insecureTLS?: boolean; source?: string } = {}
): Promise<CapturedFetchInit> {
  mockFetch.mockResolvedValueOnce(textResponse("ok"));
  await fetchTextWithPolicy("https://example.com/news", {
    timeoutMs: 1000,
    ...options
  });
  return mockFetch.mock.calls[0]?.[1] as CapturedFetchInit;
}

describe("fetchTextWithPolicy dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquire.mockReturnValue(undefined);
  });

  it("uses a TLS-relaxed Agent without proxy when insecureTLS is enabled", async () => {
    const init = await fetchOk({
      insecureTLS: true,
      source: "电缆网 cableabc"
    });

    const agentOptions = mockAgent.mock.calls[0]?.[0] as {
      connect: { rejectUnauthorized?: boolean; lookup?: unknown };
    };
    expect(agentOptions.connect.rejectUnauthorized).toBe(false);
    // T-SEC-12: 非代理路径一律挂连接时 lookup 复验（DNS rebinding TOCTOU 防线）。
    expect(typeof agentOptions.connect.lookup).toBe("function");
    expect(mockProxyAgent).not.toHaveBeenCalled();
    expect(init.dispatcher).toMatchObject({ kind: "agent" });
    expect(mocks.warn).toHaveBeenCalledWith(
      { source: "电缆网 cableabc", url: "https://example.com/news" },
      "fetch using insecure TLS"
    );
  });

  it("uses a TLS-relaxed ProxyAgent when proxy and insecureTLS are enabled", async () => {
    mocks.acquire.mockReturnValue({
      id: "proxy-1",
      server: "http://proxy.example:8080",
      disabled: false,
      failCount: 0
    });

    const init = await fetchOk({
      insecureTLS: true,
      source: "电缆网 cableabc"
    });

    expect(mockProxyAgent).toHaveBeenCalledWith({
      uri: "http://proxy.example:8080",
      requestTls: { rejectUnauthorized: false }
    });
    expect(mockAgent).not.toHaveBeenCalled();
    expect(init.dispatcher).toMatchObject({ kind: "proxy-agent" });
    expect(mockProxyPool.release).toHaveBeenCalledWith(
      expect.objectContaining({ id: "proxy-1" }),
      true
    );
    expect(mockAssertRobotsAllowed).toHaveBeenCalledWith(
      "https://example.com/news",
      "test-agent",
      expect.any(Function),
      "proxy-1"
    );
  });

  it("keeps strict TLS when only proxy is enabled", async () => {
    mocks.acquire.mockReturnValue({
      id: "proxy-1",
      server: "http://proxy.example:8080",
      disabled: false,
      failCount: 0
    });

    const init = await fetchOk();

    expect(mockProxyAgent).toHaveBeenCalledWith("http://proxy.example:8080");
    expect(mockAgent).not.toHaveBeenCalled();
    expect(init.dispatcher).toMatchObject({ kind: "proxy-agent" });
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("pins a connection-time lookup guard on the baseline dispatcher without proxy", async () => {
    const init = await fetchOk();

    // T-SEC-12: 默认路径不再是 undefined dispatcher（undici 全局 Agent），而是显式 Agent
    // 挂连接时 lookup 复验，堵「fetch 前解析合法 / 建连时换成内网 IP」的 TOCTOU 窗口。
    expect(mockAgent).toHaveBeenCalledTimes(1);
    const agentOptions = mockAgent.mock.calls[0]?.[0] as {
      connect: { lookup?: unknown; rejectUnauthorized?: boolean };
    };
    expect(typeof agentOptions.connect.lookup).toBe("function");
    expect(agentOptions.connect.rejectUnauthorized).toBeUndefined();
    expect(mockProxyAgent).not.toHaveBeenCalled();
    expect(init.dispatcher).toMatchObject({ kind: "agent" });
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mockAssertRobotsAllowed).toHaveBeenCalledWith(
      "https://example.com/news",
      "test-agent",
      expect.any(Function),
      "direct"
    );
  });

  // T-SEC-12: fetch 前守卫通过（或关闭）但建连时解析到内网 —— lookup 复验必须拒绝连接。
  it("rejects the connection when connection-time DNS resolves to a private address", async () => {
    const init = await fetchOk();
    const agentOptions = mockAgent.mock.calls[0]?.[0] as {
      connect: { lookup: LookupFunction };
    };
    const lookup = agentOptions.connect.lookup;

    mocks.dnsLookup.mockImplementation(
      (_hostname: string, _options: unknown, callback: (err: Error | null, records: unknown) => void) =>
        callback(null, [{ address: "10.0.0.5", family: 4 }])
    );

    const outcome = await new Promise<{ err: (Error & { code?: string }) | null }>((resolve) => {
      lookup("rebinding.example", { all: true }, (err) => resolve({ err }));
    });
    expect(outcome.err).toBeInstanceOf(Error);
    expect(outcome.err?.code).toBe("FETCH_SSRF_BLOCKED");
    expect(init.dispatcher).toBeDefined();
  });

  it("passes the connection when connection-time DNS resolves to public addresses only", async () => {
    await fetchOk();
    const agentOptions = mockAgent.mock.calls[0]?.[0] as {
      connect: { lookup: LookupFunction };
    };
    const records = [{ address: "93.184.216.34", family: 4 }];
    mocks.dnsLookup.mockImplementation(
      (_hostname: string, _options: unknown, callback: (err: Error | null, records: unknown) => void) =>
        callback(null, records)
    );

    const outcome = await new Promise<{ err: Error | null; addresses: unknown }>((resolve) => {
      agentOptions.connect.lookup("example.com", { all: true }, (err, addresses) =>
        resolve({ err, addresses })
      );
    });
    expect(outcome.err).toBeNull();
    expect(outcome.addresses).toEqual(records);
  });

  it("exempts FETCH_INTERNAL_ALLOWLIST hostnames from the connection-time lookup guard", async () => {
    await fetchOk();
    const agentOptions = mockAgent.mock.calls[0]?.[0] as {
      connect: { lookup: LookupFunction };
    };
    const records = [{ address: "172.18.0.5", family: 4 }];
    mocks.dnsLookup.mockImplementation(
      (_hostname: string, _options: unknown, callback: (err: Error | null, records: unknown) => void) =>
        callback(null, records)
    );

    // 内部服务（如 rsshub:1200）解析到私网 IP 属正常，与 assertPublicFetchUrl 的 allowlist 分支同一豁免。
    const restore = setInternalAllowlistForTests("rsshub");
    try {
      const outcome = await new Promise<{ err: Error | null; addresses: unknown }>((resolve) => {
        agentOptions.connect.lookup("rsshub", { all: true }, (err, addresses) =>
          resolve({ err, addresses })
        );
      });
      expect(outcome.err).toBeNull();
      expect(outcome.addresses).toEqual(records);
    } finally {
      restore();
    }
  });

  it("rejects a response that exceeds the configured byte limit", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("123456"));

    await expect(
      fetchTextWithPolicy("https://example.com/news", {
        timeoutMs: 1000,
        maxResponseBytes: 5
      })
    ).rejects.toMatchObject({ code: "FETCH_RESPONSE_TOO_LARGE" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // T-SEC-12: SSRF 守卫在 robots / fetch 之前拦截内网 / metadata 目的地（literal IP 无需 DNS）。
  // vitest.config 默认 SSRF_GUARD_ENABLED=false；本用例显式开启以验证守卫逻辑。
  it("blocks SSRF targets (metadata IP / loopback) before any network call", async () => {
    vi.stubEnv("SSRF_GUARD_ENABLED", "true");
    try {
      await expect(
        fetchTextWithPolicy("http://169.254.169.254/latest/meta-data/", { timeoutMs: 1000 })
      ).rejects.toMatchObject({ code: "FETCH_SSRF_BLOCKED" });
      await expect(
        fetchTextWithPolicy("http://127.0.0.1:5432/", { timeoutMs: 1000 })
      ).rejects.toMatchObject({ code: "FETCH_SSRF_BLOCKED" });
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv("SSRF_GUARD_ENABLED", "false");
    }
  });
});

describe("fetchTextWithPolicy init support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquire.mockReturnValue(undefined);
  });

  it("forwards POST method and body while keeping the policy user-agent", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("ok"));

    await fetchTextWithPolicy(
      "https://ecp.sgcc.com.cn/ecp2.0/ecpwcmcore/index/noteList",
      {
        timeoutMs: 1000,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "evil-attempted-override"
          },
          body: '{"index":1,"size":1}'
        }
      }
    );

    const init = mockFetch.mock.calls[0]?.[1] as CapturedFetchInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"index":1,"size":1}');
    const headers = init.headers as Record<string, string>;
    expect(headers["user-agent"]).toBe("test-agent");
    expect(headers["content-type"]).toBe("application/json");
    // Caller-supplied signal must not replace the policy timeout abort.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("omits caller init when not provided", async () => {
    mockFetch.mockResolvedValueOnce(textResponse("ok"));

    await fetchTextWithPolicy("https://example.com/news", { timeoutMs: 1000 });

    const init = mockFetch.mock.calls[0]?.[1] as CapturedFetchInit;
    expect(init.method).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers["user-agent"]).toBe("test-agent");
  });
});
