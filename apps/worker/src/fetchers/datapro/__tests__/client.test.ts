import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { dataproSearch, resolveDataproApiKey } from "../client";

function buildMcpResponse(items: unknown[]): Response {
  const text = JSON.stringify({ items });
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text }] },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("datapro client", () => {
  it("returns parsed items from valid JSON-RPC response", async () => {
    const items = [{ table: { name: "电解铜", price: "70000" } }];
    const fetchImpl = vi.fn().mockResolvedValue(buildMcpResponse(items));

    const result = await dataproSearch("铜价格", { apiKey: "test-key", fetchImpl });

    expect(result).toEqual(items);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://datapro.hqd.cn-beijing.volces.com/mcp");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-agent-plan-key"]).toBe("test-key");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tools/call");
    const params = body.params as { name: string; arguments: { query: string } };
    expect(params.name).toBe("dataPro_search");
    expect(params.arguments.query).toBe("铜价格");
    expect(body.id).toBe(1);
  });

  it("throws FETCH_CONFIG when API key is missing", async () => {
    vi.stubEnv("DATAPRO_AGENT_PLAN_KEY", "");
    vi.stubEnv("DATAPRO_AGENT_PLAN_KEY_FILE", "");

    expect(resolveDataproApiKey()).toBeUndefined();
    await expect(dataproSearch("铜价格")).rejects.toMatchObject({
      code: "FETCH_CONFIG",
    });

    vi.unstubAllEnvs();
  });

  it("throws SourceFetchError on HTTP 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 })
    );

    await expect(
      dataproSearch("铜价格", { apiKey: "test-key", fetchImpl })
    ).rejects.toMatchObject({ code: "FETCH_HTTP_ERROR" });
  });

  it("throws FETCH_TIMEOUT on HTTP timeout (does not hang)", async () => {
    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";
    const fetchImpl = vi.fn().mockRejectedValue(timeoutError);

    await expect(
      dataproSearch("铜价格", { apiKey: "test-key", fetchImpl, timeoutMs: 100 })
    ).rejects.toMatchObject({ code: "FETCH_TIMEOUT" });
  });

  it("reads API key from DATAPRO_AGENT_PLAN_KEY_FILE when plain env is unset", () => {
    const dir = mkdtempSync(join(tmpdir(), "datapro-key-"));
    const keyFile = join(dir, "datapro_api_key");
    writeFileSync(keyFile, "dp-from-file\n", "utf8");

    vi.stubEnv("DATAPRO_AGENT_PLAN_KEY", "");
    vi.stubEnv("DATAPRO_AGENT_PLAN_KEY_FILE", keyFile);
    expect(resolveDataproApiKey()).toBe("dp-from-file");
    vi.unstubAllEnvs();
  });
});
