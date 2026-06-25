import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveWebsearchApiKey, websearchSearch } from "../client";

function buildWebsearchResponse(results: unknown[]): Response {
  return new Response(
    JSON.stringify({ Result: { WebResults: results } }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("websearch client", () => {
  it("returns parsed WebResults from valid response", async () => {
    const results = [
      { Title: "电解铜价格走势", Url: "https://example.com/copper", Snippet: "铜价上涨", PublishTime: "2026-06-24T10:00:00Z" },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(buildWebsearchResponse(results));

    const out = await websearchSearch("电解铜 价格", { apiKey: "test-key", fetchImpl });

    expect(out).toEqual(results);
    expect(fetchImpl).toHaveBeenCalledOnce();

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://open.feedcoopapi.com/search_api/web_search");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["authorization"]).toBe("Bearer test-key");

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.Query).toBe("电解铜 价格");
    expect(body.SearchType).toBe("web");
    expect(body.Count).toBe(10);
    expect(body.TimeRange).toBe("OneWeek");
    const filter = body.Filter as { AuthInfoLevel: number };
    expect(filter.AuthInfoLevel).toBe(0);
  });

  it("passes through timeRange / count / authInfoLevel options", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(buildWebsearchResponse([]));

    await websearchSearch("铜", {
      apiKey: "test-key",
      fetchImpl,
      timeRange: "OneDay",
      count: 5,
      authInfoLevel: 2,
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1].body)) as Record<string, unknown>;
    expect(body.TimeRange).toBe("OneDay");
    expect(body.Count).toBe(5);
    const filter = body.Filter as { AuthInfoLevel: number };
    expect(filter.AuthInfoLevel).toBe(2);
  });

  it("throws FETCH_CONFIG when API key is missing", async () => {
    vi.stubEnv("WEBSEARCH_API_KEY", "");
    vi.stubEnv("WEBSEARCH_API_KEY_FILE", "");

    expect(resolveWebsearchApiKey()).toBeUndefined();
    await expect(websearchSearch("铜价格")).rejects.toMatchObject({
      code: "FETCH_CONFIG",
    });

    vi.unstubAllEnvs();
  });

  it("throws SourceFetchError on HTTP 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 })
    );

    await expect(
      websearchSearch("铜价格", { apiKey: "test-key", fetchImpl })
    ).rejects.toMatchObject({ code: "FETCH_HTTP_ERROR" });
  });

  it("throws FETCH_TIMEOUT on HTTP timeout (does not hang)", async () => {
    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";
    const fetchImpl = vi.fn().mockRejectedValue(timeoutError);

    await expect(
      websearchSearch("铜价格", { apiKey: "test-key", fetchImpl, timeoutMs: 100 })
    ).rejects.toMatchObject({ code: "FETCH_TIMEOUT" });
  });

  it("returns [] when response has no Result.WebResults array", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ Result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const out = await websearchSearch("铜价格", { apiKey: "test-key", fetchImpl });
    expect(out).toEqual([]);
  });

  it("reads API key from WEBSEARCH_API_KEY_FILE when plain env is unset", () => {
    const dir = mkdtempSync(join(tmpdir(), "websearch-key-"));
    const keyFile = join(dir, "websearch_api_key");
    writeFileSync(keyFile, "ws-from-file\n", "utf8");

    vi.stubEnv("WEBSEARCH_API_KEY", "");
    vi.stubEnv("WEBSEARCH_API_KEY_FILE", keyFile);
    expect(resolveWebsearchApiKey()).toBe("ws-from-file");
    vi.unstubAllEnvs();
  });

  it("uses WEBSEARCH_API_URL env override for base URL", async () => {
    vi.stubEnv("WEBSEARCH_API_URL", "https://custom.example.com/search");
    const fetchImpl = vi.fn().mockResolvedValue(buildWebsearchResponse([]));

    await websearchSearch("铜", { apiKey: "test-key", fetchImpl });

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://custom.example.com/search");
    vi.unstubAllEnvs();
  });
});
