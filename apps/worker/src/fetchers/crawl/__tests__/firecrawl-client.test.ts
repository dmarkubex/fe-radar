import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { firecrawlSearch, resolveFirecrawlApiKey } from "../firecrawl-client";

describe("firecrawl client", () => {
  it("reads API key from FIRECRAWL_API_KEY_FILE when plain env is unset", () => {
    const dir = mkdtempSync(join(tmpdir(), "firecrawl-key-"));
    const keyFile = join(dir, "firecrawl_api_key");
    writeFileSync(keyFile, "fc-from-file\n", "utf8");

    vi.stubEnv("FIRECRAWL_API_KEY", "");
    vi.stubEnv("FIRECRAWL_API_KEY_FILE", keyFile);
    expect(resolveFirecrawlApiKey()).toBe("fc-from-file");
    vi.unstubAllEnvs();
  });

  it("requires API key", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    expect(resolveFirecrawlApiKey()).toBeUndefined();
    await expect(firecrawlSearch({ query: "远东 诉讼" })).rejects.toMatchObject({
      code: "FETCH_CONFIG",
    });
    vi.unstubAllEnvs();
  });

  it("posts search request with CN defaults", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { web: [] } }), { status: 200 })
    );

    await firecrawlSearch(
      {
        query: "远东控股 诉讼",
        limit: 3,
        includeDomains: ["news.bjx.com.cn"],
      },
      { apiKey: "test-key", fetchImpl }
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.firecrawl.dev/v2/search");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.query).toBe("远东控股 诉讼");
    expect(body.country).toBe("CN");
    expect(body.includeDomains).toEqual(["news.bjx.com.cn"]);
  });
});
