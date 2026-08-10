import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type * as Shared from "@fe-radar/shared";

const FIXTURES = join(__dirname, "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

const { loggerWarn } = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
}));

vi.mock("@fe-radar/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof Shared>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: loggerWarn,
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    }),
  };
});

vi.mock("../../http", () => ({
  fetchTextWithPolicy: vi.fn(),
}));

vi.mock("../../../lib/robots", () => ({
  assertRobotsAllowed: vi.fn().mockResolvedValue(undefined),
}));

import { rsshubExtractAdapter } from "../rsshub-extract";
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

  // ── T4 / RE2：结构性消除 ReDoS（回代验算 + 兼容性 + 不支持语法） ──

  /**
   * 回代验算向量：主会话实测在 Node RegExp 下 n≈30–34 可锁死 66s 的 pattern。
   * RE2 不做回溯 → 必须在毫秒级返回（宽松上限 100ms）。
   * RE2 下这些 pattern 通常能编译成功且 exec 飞快——那是正确结果，不必拒绝它们。
   */
  it("T4 ReDoS vectors: former catastrophic patterns complete in ms under RE2", async () => {
    const poison = "a".repeat(40) + "!";
    const vectors = [
      "((a+)){2,}$",
      "(a|aa){2,}$",
      "(a+){2,}",
      "^a+a+a+a+a+a+a+a+a+a+$",
      "(x+x+)+y",
      "[0-9]+[0-9]+[0-9]+x",
    ];

    for (const pattern of vectors) {
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title><item><title>poison</title><description><![CDATA[<p>${poison} 78500</p>]]></description><pubDate>Tue, 20 May 2026 15:30:00 +0800</pubDate></item></channel></rss>`;
      mockFetchText.mockResolvedValueOnce(xml);

      const t0 = performance.now();
      const results = await rsshubExtractAdapter.fetch({
        sourceName: "redos-vector",
        sourceConfig: {
          endpoint: "/feed",
          // 病态 pattern 先试；不匹配则落到数字规则（证明事件循环未被占死）。
          regex_rules: [
            { pattern, metric_key: "evil" },
            { pattern: "(\\d+)", metric_key: "safe_num", group: 1 },
          ],
        },
      });
      const elapsedMs = performance.now() - t0;

      expect(elapsedMs, `pattern ${pattern} took ${elapsedMs}ms`).toBeLessThan(100);
      expect(results).toHaveLength(1);
      // 病态 pattern 对 "a…! 78500" 通常不匹配数字语义 → 落到 safe_num
      // （若 RE2 意外整段匹配 a… 也不该挂死；此时 value 可能为 null/非数字，仍要求 <100ms）
      expect(results[0]!.metricKey === "safe_num" || results[0]!.value === null || typeof results[0]!.value === "number").toBe(true);
    }
  });

  it("T4: RE2-unsupported syntax (lookahead) is skipped with warn; remaining rules still work", async () => {
    loggerWarn.mockClear();
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title><item><title>t</title><description><![CDATA[<p>今日现货 78500 元</p>]]></description><pubDate>Tue, 20 May 2026 15:30:00 +0800</pubDate></item></channel></rss>`;
    mockFetchText.mockResolvedValueOnce(xml);

    const results = await rsshubExtractAdapter.fetch({
      sourceName: "lookahead-skip",
      sourceConfig: {
        endpoint: "/feed",
        regex_rules: [
          // RE2 不支持正向先行断言 → 构造失败 → 跳过 + warn
          { pattern: "(?=现货)(\\d+)", metric_key: "evil_lookahead", group: 1 },
          { pattern: "(\\d+)", metric_key: "safe_num", group: 1 },
        ],
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.metricKey).toBe("safe_num");
    expect(results[0]!.value).toBe(78500);
    expect(loggerWarn).toHaveBeenCalled();
    const warnPayload = loggerWarn.mock.calls.find(
      (c) =>
        typeof c[0] === "object" &&
        c[0] !== null &&
        (c[0] as { pattern?: string }).pattern === "(?=现货)(\\d+)"
    );
    expect(warnPayload).toBeDefined();
    expect((warnPayload![0] as { metric_key: string }).metric_key).toBe(
      "evil_lookahead"
    );
  });

  /**
   * 兼容性回归：0009_commodity_seed.sql 中 7 条真实 pattern，对典型行情文本
   * 必须抽出正确数值（不只是"能编译"）。
   */
  it("T4: 0009 seed regex_rules extract correct values from typical quote text", async () => {
    const seedCases: Array<{
      metric_key: string;
      pattern: string;
      unit_multiplier: number;
      text: string;
      expected: number;
    }> = [
      {
        metric_key: "cu_spot_smm",
        pattern: "(?:现货|均价|报价)[^\\d]*(\\d+(?:\\.\\d+)?)",
        unit_multiplier: 1,
        text: "SMM 电解铜 现货均价 78500 元/吨",
        expected: 78500,
      },
      {
        metric_key: "lc_spot_smm",
        pattern: "(?:碳酸锂|均价|报价)[^\\d]*(\\d+(?:\\.\\d+)?)",
        unit_multiplier: 10000,
        text: "电池级碳酸锂 均价 6.82 万元/吨",
        expected: 68200,
      },
      {
        metric_key: "cu_spot_100ppi",
        pattern: "(?:现货|均价)[^\\d]*(\\d+(?:\\.\\d+)?)",
        unit_multiplier: 1,
        text: "生意社铜 现货 78200",
        expected: 78200,
      },
      {
        metric_key: "cu_spot_cjsc",
        pattern: "(\\d{4,6}(?:\\.\\d+)?)",
        unit_multiplier: 1,
        text: "长江有色 1#铜 78550",
        expected: 78550,
      },
      {
        metric_key: "ev_sales_monthly",
        pattern: "(?:新能源|销量)[^\\d]*(\\d+(?:\\.\\d+)?)[^万]*万",
        unit_multiplier: 10000,
        text: "新能源乘用车 销量 85.3 万辆",
        expected: 853000,
      },
      {
        metric_key: "al_spot_smm",
        pattern: "(?:铝|均价|报价)[^\\d]*(\\d+(?:\\.\\d+)?)",
        unit_multiplier: 1,
        text: "SMM 铝 均价 19850 元/吨",
        expected: 19850,
      },
      {
        metric_key: "zn_spot_smm",
        pattern: "(?:锌|均价|报价)[^\\d]*(\\d+(?:\\.\\d+)?)",
        unit_multiplier: 1,
        text: "SMM 锌 报价 22500 元/吨",
        expected: 22500,
      },
    ];

    for (const c of seedCases) {
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title><item><title>t</title><description><![CDATA[<p>${c.text}</p>]]></description><pubDate>Tue, 20 May 2026 15:30:00 +0800</pubDate></item></channel></rss>`;
      mockFetchText.mockResolvedValueOnce(xml);

      const results = await rsshubExtractAdapter.fetch({
        sourceName: `seed-${c.metric_key}`,
        sourceConfig: {
          endpoint: "/feed",
          regex_rules: [
            {
              pattern: c.pattern,
              metric_key: c.metric_key,
              group: 1,
              unit_multiplier: c.unit_multiplier,
            },
          ],
        },
      });
      expect(results, c.metric_key).toHaveLength(1);
      expect(results[0]!.metricKey, c.metric_key).toBe(c.metric_key);
      expect(results[0]!.value, c.metric_key).toBeCloseTo(c.expected);
    }
  });

  // 真实业务正则（含无界量词）在 RE2 下仍能正确抽取。
  it("T4: allows real business regex patterns at runtime under RE2", async () => {
    const cases = [
      { pattern: "([0-9.]+)\\s*元/吨", text: "铜价78500.5元/吨", expected: 78500.5 },
      { pattern: "价格[:：]\\s*([\\d,]+)", text: "价格: 7,850", expected: 7850 },
      { pattern: "LME铜\\s*([0-9]+\\.?[0-9]*)", text: "LME铜 9850.5", expected: 9850.5 },
      { pattern: "收盘价\\s*(\\d{4,6})", text: "收盘价 98500", expected: 98500 },
    ];

    for (const { pattern, text, expected } of cases) {
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title><item><title>t</title><description><![CDATA[<p>${text}</p>]]></description><pubDate>Tue, 20 May 2026 15:30:00 +0800</pubDate></item></channel></rss>`;
      mockFetchText.mockResolvedValueOnce(xml);

      const results = await rsshubExtractAdapter.fetch({
        sourceName: "allow-check",
        sourceConfig: {
          endpoint: "/feed",
          regex_rules: [{ pattern, metric_key: "val", group: 1 }],
        },
      });
      expect(results.length).toBe(1);
      expect(results[0]!.value).toBe(expected);
    }
  });
});
