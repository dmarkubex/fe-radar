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
    metricKey: "cu_main_close",
  },
];

/** Regex rules for SMM lithium carbonate: N.NN万元/吨 */
const LC_REGEX_RULES = [
  {
    pattern: "([\\d.]+)\\s*万元/吨",
    group: 1,
    metricKey: "lc_main_avg",
    multiplier: 10000,
  },
];

/** Regex rules for soda ash: N元/吨 */
const SODA_REGEX_RULES = [
  {
    pattern: "(\\d[\\d,]*)\\s*元/吨",
    group: 1,
    metricKey: "soda_ash_price",
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
              metricKey: "cu_lme_close",
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
          regex_rules: [{ pattern: "NEVER_MATCHES_XYZ", group: 1, metricKey: "test" }],
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
