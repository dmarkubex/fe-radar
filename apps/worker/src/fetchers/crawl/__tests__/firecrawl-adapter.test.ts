import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  firecrawlSearch: vi.fn(),
  resolveFirecrawlApiKey: vi.fn(),
  assertRobotsAllowed: vi.fn(),
}));

vi.mock("../firecrawl-client", () => ({
  firecrawlSearch: mocks.firecrawlSearch,
  resolveFirecrawlApiKey: mocks.resolveFirecrawlApiKey,
}));

vi.mock("../../../lib/robots", () => ({
  assertRobotsAllowed: mocks.assertRobotsAllowed,
}));

vi.mock("../../../lib/ua-pool", () => ({
  acquireUserAgent: vi.fn(() => "test-agent"),
}));

import { firecrawlAdapter } from "../firecrawl-adapter";
import type { CrawlSourceConfig } from "../types";

const config: CrawlSourceConfig = {
  type: "crawl",
  adapter: "firecrawl",
  queries: ["远东控股 诉讼", "远东电缆 处罚"],
  includeDomains: ["www.gov.cn"],
  entityKeywords: ["远东控股", "远东电缆"],
  riskKeywords: ["诉讼", "处罚"],
};

describe("firecrawl adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveFirecrawlApiKey.mockReturnValue("test-key");
    mocks.assertRobotsAllowed.mockResolvedValue(undefined);
  });

  it("throws FETCH_CONFIG when API key is missing", async () => {
    mocks.resolveFirecrawlApiKey.mockReturnValue(undefined);

    await expect(firecrawlAdapter.fetch(config, { sourceName: "risk" })).rejects.toMatchObject({
      code: "FETCH_CONFIG",
    });
  });

  it("throws when all queries fail", async () => {
    mocks.firecrawlSearch.mockRejectedValue(new Error("network down"));

    await expect(firecrawlAdapter.fetch(config, { sourceName: "risk" })).rejects.toMatchObject({
      code: "FETCH_ALL_QUERIES_FAILED",
    });
  });

  it("keeps successful query results when another query fails", async () => {
    mocks.firecrawlSearch
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        success: true,
        data: {
          web: [{
            url: "https://example.com/a",
            title: "远东电缆收到处罚告知",
            description: "市场监管局行政处罚",
          }],
        },
      });

    const items = await firecrawlAdapter.fetch(config, { sourceName: "risk" });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      url: "https://example.com/a",
      title: "远东电缆收到处罚告知",
    });
  });

  it("drops search results blocked by local robots guard", async () => {
    mocks.assertRobotsAllowed.mockRejectedValue(new Error("robots disallow"));
    mocks.firecrawlSearch.mockResolvedValue({
      success: true,
      data: {
        web: [{
          url: "https://example.com/a",
          title: "远东电缆收到处罚告知",
          description: "市场监管局行政处罚",
        }],
      },
    });

    const items = await firecrawlAdapter.fetch(config, { sourceName: "risk" });

    expect(items).toEqual([]);
  });
});
