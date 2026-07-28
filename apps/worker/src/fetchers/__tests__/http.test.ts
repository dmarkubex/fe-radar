import type * as Shared from "@fe-radar/shared";
import type * as Undici from "undici";
import { fetch as undiciFetch, Agent, ProxyAgent } from "undici";
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

    expect(mockAgent).toHaveBeenCalledWith({
      connect: { rejectUnauthorized: false }
    });
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

  it("keeps the baseline strict TLS dispatcher path without proxy", async () => {
    const init = await fetchOk();

    expect(mockAgent).not.toHaveBeenCalled();
    expect(mockProxyAgent).not.toHaveBeenCalled();
    expect(init.dispatcher).toBeUndefined();
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mockAssertRobotsAllowed).toHaveBeenCalledWith(
      "https://example.com/news",
      "test-agent",
      expect.any(Function),
      "direct"
    );
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
});
