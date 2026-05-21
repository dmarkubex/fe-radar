import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { rsshubExtractAdapter } from "../rsshub-extract";

const FIXTURES = join(__dirname, "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

vi.mock("../../http", () => ({
  fetchTextWithPolicy: vi.fn(),
}));

vi.mock("../../../lib/robots", () => ({
  assertRobotsAllowed: vi.fn().mockResolvedValue(undefined),
}));

import { fetchTextWithPolicy } from "../../http";

const mockFetchText = vi.mocked(fetchTextWithPolicy);

/** Regex rules for SMM copper price: 数字后面跟元/吨 */
const CU_REGEX_RULES = [
  {
    pattern: "(\\d[\\d,]*)\\s*元/吨",
    group: 1,
    metric_key: "cu_main_close",
  },
];

/** Regex rules for SMM lithium carbonate: N.NN万元/吨 */
const LC_REGEX_RULES = [
  {
    pattern: "([\\d.]+)\\s*万元/吨",
    group: 1,
    metric_key: "lc_main_avg",
    unit_multiplier: 10000,
  },
];

/** Regex rules for soda ash: N元/吨 */
const SODA_REGEX_RULES = [
  {
    pattern: "(\\d[\\d,]*)\\s*元/吨",
    group: 1,
    metric_key: "soda_ash_price",
  },
];

describe("rsshubExtractAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["RSSHUB_BASE_URL"] = "http://rsshub:1200";
  });

  it("has correct name", () => {
    expect(rsshubExtractAdapter.name).toBe("rsshub-extract");
  });

  describe("SMM 铜价 (cu_main_close)", () => {
    it("extracts copper price from RSS fixture", async () => {
      mockFetchText.mockResolvedValueOnce(loadFixture("rsshub-smm-cu.xml"));

      const ctx = {
        sourceName: "smm-cu",
        sourceConfig: {
          endpoint: "/smm/news/cu",
          regex_rules: CU_REGEX_RULES,
        },
      };

      const results = await rsshubExtractAdapter.fetch(ctx);

      expect(results.length).toBeGreaterThan(0);
      const sample = results[0]!;
      expect(sample.metricKey).toBe("cu_main_close");
      expect(sample.value).toBe(78500);
      expect(sample.rawText).not.toContain("<");
      expect(Array.from(sample.rawText).length).toBeLessThanOrEqual(2000);
      expect(sample.observedAt).toBeInstanceOf(Date);
    });
  });

  describe("SMM 碳酸锂价格 (lc_main_avg)", () => {
    it("extracts lithium carbonate price with unit multiplier", async () => {
      mockFetchText.mockResolvedValueOnce(loadFixture("rsshub-smm-lc.xml"));

      const ctx = {
        sourceName: "smm-lc",
        sourceConfig: {
          endpoint: "/smm/news/lc",
          regex_rules: LC_REGEX_RULES,
        },
      };

      const results = await rsshubExtractAdapter.fetch(ctx);

      expect(results.length).toBeGreaterThan(0);
      const sample = results[0]!;
      expect(sample.metricKey).toBe("lc_main_avg");
      // 6.82 万元/吨 × 10000 = 68200
      expect(sample.value).toBeCloseTo(68200);
      expect(sample.rawText).not.toContain("<");
    });
  });

  describe("生意社纯碱价格 (soda_ash_price)", () => {
    it("extracts soda ash price from RSS fixture", async () => {
      mockFetchText.mockResolvedValueOnce(
        loadFixture("rsshub-shengyi-soda.xml")
      );

      const ctx = {
        sourceName: "shengyi-soda",
        sourceConfig: {
          endpoint: "/100ppi/price/soda",
          regex_rules: SODA_REGEX_RULES,
        },
      };

      const results = await rsshubExtractAdapter.fetch(ctx);

      expect(results.length).toBeGreaterThan(0);
      const sample = results[0]!;
      expect(sample.metricKey).toBe("soda_ash_price");
      expect(sample.value).toBe(1580);
      expect(sample.rawText).not.toContain("<");
    });
  });

  describe("正则未命中 (no match → value=null)", () => {
    it("sets value=null and preserves rawText when regex does not match", async () => {
      mockFetchText.mockResolvedValueOnce(loadFixture("rsshub-nomatch.xml"));

      const ctx = {
        sourceName: "nomatch-source",
        sourceConfig: {
          endpoint: "/some/feed",
          regex_rules: [
            {
              pattern: "(\\d+\\.\\d+)\\s*美元/吨",
              group: 1,
              metric_key: "cu_lme_close",
            },
          ],
        },
      };

      const results = await rsshubExtractAdapter.fetch(ctx);

      expect(results.length).toBeGreaterThan(0);
      const sample = results[0]!;
      expect(sample.value).toBeNull();
      // rawText must be preserved for audit even on miss
      expect(typeof sample.rawText).toBe("string");
      expect(sample.rawText.length).toBeGreaterThan(0);
      expect(sample.rawText).not.toContain("<");
    });

    it("does NOT call LLM on regex miss (NFR-102)", async () => {
      // This test verifies no LLM module is invoked.
      // If any LLM import were called it would throw (not mocked).
      mockFetchText.mockResolvedValueOnce(loadFixture("rsshub-nomatch.xml"));

      const ctx = {
        sourceName: "nomatch-source",
        sourceConfig: {
          endpoint: "/feed",
          regex_rules: [{ pattern: "NEVER_MATCHES_XYZ", group: 1, metric_key: "test" }],
        },
      };

      // Should complete without error and return null value
      const results = await rsshubExtractAdapter.fetch(ctx);
      expect(results[0]?.value).toBeNull();
    });
  });

  it("returns [] when fetchTextWithPolicy throws", async () => {
    mockFetchText.mockRejectedValueOnce(new Error("RSSHub unreachable"));

    const ctx = {
      sourceName: "rsshub-source",
      sourceConfig: { endpoint: "/smm/news/cu", regex_rules: CU_REGEX_RULES },
    };

    const results = await rsshubExtractAdapter.fetch(ctx);
    expect(results).toEqual([]);
  });

  it("returns [] when endpoint is missing from sourceConfig", async () => {
    const ctx = {
      sourceName: "no-endpoint",
      sourceConfig: { regex_rules: CU_REGEX_RULES },
    };

    const results = await rsshubExtractAdapter.fetch(ctx);
    expect(results).toEqual([]);
    expect(mockFetchText).not.toHaveBeenCalled();
  });

  it("constructs full URL from RSSHUB_BASE_URL env + endpoint", async () => {
    process.env["RSSHUB_BASE_URL"] = "http://internal-rsshub:1200";
    mockFetchText.mockResolvedValueOnce(loadFixture("rsshub-smm-cu.xml"));

    const ctx = {
      sourceName: "smm-cu",
      sourceConfig: { endpoint: "/smm/news/cu", regex_rules: CU_REGEX_RULES },
    };
    await rsshubExtractAdapter.fetch(ctx);

    expect(mockFetchText).toHaveBeenCalledWith(
      "http://internal-rsshub:1200/smm/news/cu",
      expect.any(Object)
    );
  });

  it("uses absolute endpoint without prefixing RSSHUB_BASE_URL", async () => {
    process.env["RSSHUB_BASE_URL"] = "http://internal-rsshub:1200";
    mockFetchText.mockResolvedValueOnce(loadFixture("rsshub-smm-cu.xml"));

    const ctx = {
      sourceName: "smm-cu",
      sourceConfig: {
        endpoint: "http://rsshub:1200/smm/news/cu",
        regex_rules: CU_REGEX_RULES,
      },
    };
    await rsshubExtractAdapter.fetch(ctx);

    expect(mockFetchText).toHaveBeenCalledWith(
      "http://rsshub:1200/smm/news/cu",
      expect.any(Object)
    );
  });

  it("keeps backward-compatible reads for legacy camelCase rules", async () => {
    mockFetchText.mockResolvedValueOnce(loadFixture("rsshub-smm-lc.xml"));

    const ctx = {
      sourceName: "legacy-lc",
      sourceConfig: {
        endpoint: "/smm/news/lc",
        regex_rules: [
          {
            pattern: "([\\d.]+)\\s*万元/吨",
            group: 1,
            metricKey: "lc_legacy",
            multiplier: 10000,
          },
        ],
      },
    };

    const results = await rsshubExtractAdapter.fetch(ctx);
    expect(results[0]?.metricKey).toBe("lc_legacy");
    expect(results[0]?.value).toBeCloseTo(68200);
  });

  describe("single-sample emission (T-CB-08-FIX2 · DMA-163)", () => {
    it("emits exactly 1 sample even when feed has many items", async () => {
      // Build a feed with 5 items, only the 3rd contains a copper price.
      const items = [
        `<item><title>会议预告</title><description>SMM 行业会议</description><pubDate>Tue, 20 May 2026 09:00:00 +0800</pubDate></item>`,
        `<item><title>市场点评</title><description>宏观面影响</description><pubDate>Tue, 20 May 2026 10:00:00 +0800</pubDate></item>`,
        `<item><title>铜价行情</title><description><![CDATA[<p>今日均价 78500 元/吨</p>]]></description><pubDate>Tue, 20 May 2026 15:30:00 +0800</pubDate></item>`,
        `<item><title>下游需求</title><description>线缆需求平稳</description><pubDate>Tue, 20 May 2026 16:00:00 +0800</pubDate></item>`,
        `<item><title>库存动态</title><description>仓单减少</description><pubDate>Tue, 20 May 2026 17:00:00 +0800</pubDate></item>`,
      ].join("");
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>SMM Cu</title>${items}</channel></rss>`;
      mockFetchText.mockResolvedValueOnce(xml);

      const ctx = {
        sourceName: "smm-cu",
        sourceConfig: { endpoint: "/smm/news/cu", regex_rules: CU_REGEX_RULES },
      };

      const results = await rsshubExtractAdapter.fetch(ctx);

      // Exactly 1 sample — no pollution from non-price items
      expect(results).toHaveLength(1);
      expect(results[0]!.metricKey).toBe("cu_main_close");
      expect(results[0]!.value).toBe(78500);
      // observedAt comes from the winner item (15:30), not the 1st item (09:00)
      expect(results[0]!.observedAt.toISOString()).toBe(
        new Date("Tue, 20 May 2026 15:30:00 +0800").toISOString()
      );
    });

    it("emits exactly 1 null sample when no item matches, anchored to items[0]", async () => {
      const items = [
        `<item><title>会议预告</title><description>SMM 行业会议</description><pubDate>Tue, 20 May 2026 09:00:00 +0800</pubDate></item>`,
        `<item><title>市场点评</title><description>宏观面影响</description><pubDate>Tue, 20 May 2026 10:00:00 +0800</pubDate></item>`,
      ].join("");
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>SMM Cu</title>${items}</channel></rss>`;
      mockFetchText.mockResolvedValueOnce(xml);

      const ctx = {
        sourceName: "smm-cu",
        sourceConfig: { endpoint: "/smm/news/cu", regex_rules: CU_REGEX_RULES },
      };

      const results = await rsshubExtractAdapter.fetch(ctx);

      expect(results).toHaveLength(1);
      expect(results[0]!.value).toBeNull();
      // metricKey falls back to firstMetricKey resolution
      expect(results[0]!.metricKey).toBe("cu_main_close");
      // rawText anchored to items[0] (会议预告)
      expect(results[0]!.rawText).toContain("会议预告");
      expect(results[0]!.observedAt.toISOString()).toBe(
        new Date("Tue, 20 May 2026 09:00:00 +0800").toISOString()
      );
    });

    it("emits [] on empty RSS feed", async () => {
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>`;
      mockFetchText.mockResolvedValueOnce(xml);

      const ctx = {
        sourceName: "empty-source",
        sourceConfig: { endpoint: "/empty", regex_rules: CU_REGEX_RULES },
      };

      const results = await rsshubExtractAdapter.fetch(ctx);
      expect(results).toEqual([]);
    });
  });

  it("rawText is truncated to ≤2000 Unicode code points for very long descriptions", async () => {
    const longDesc = "价格数据".repeat(1000);
    const longXml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title><item><title>价格行情</title><description><![CDATA[<p>${longDesc}</p>]]></description><pubDate>Tue, 20 May 2026 15:30:00 +0800</pubDate></item></channel></rss>`;
    mockFetchText.mockResolvedValueOnce(longXml);

    const ctx = {
      sourceName: "long-source",
      sourceConfig: { endpoint: "/feed", regex_rules: CU_REGEX_RULES },
    };

    const results = await rsshubExtractAdapter.fetch(ctx);
    expect(results.length).toBeGreaterThan(0);
    expect(Array.from(results[0]!.rawText).length).toBeLessThanOrEqual(2000);
  });
});
