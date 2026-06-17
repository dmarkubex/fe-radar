import { describe, expect, it } from "vitest";
import { createSourceSchema } from "../../../../lib/api/sources-schema";

describe("sources api schema", () => {
  it("accepts matching rss source", () => {
    expect(createSourceSchema.safeParse({
      name: "北极星电力新闻网",
      url: "https://news.bjx.com.cn/rss.xml",
      fetcherType: "rss",
      tier: "T2",
      config: { type: "rss", url: "https://news.bjx.com.cn/rss.xml" }
    }).success).toBe(true);
  });

  it("rejects mismatched fetcher type and config", () => {
    expect(createSourceSchema.safeParse({
      name: "bad",
      url: "https://example.com",
      fetcherType: "rss",
      tier: "T2",
      config: { type: "html", listUrl: "https://example.com", selectors: { item: ".i", title: ".t", link: "a", date: ".d" } }
    }).success).toBe(false);
  });

  it("accepts quotes config with snake_case regex rules and relative endpoint", () => {
    const result = createSourceSchema.safeParse({
      name: "RSSHub 数值抽取-SMM 铜",
      url: "http://rsshub:1200/smm/news/cu",
      fetcherType: "quotes",
      tier: "T2",
      config: {
        type: "quotes",
        adapter: "rsshub-extract",
        metric_keys: ["cu_spot_smm"],
        endpoint: "/smm/news/cu",
        retry: { max: 2, backoffMs: 1000 },
        regex_rules: [
          {
            pattern: "(?:现货|均价|报价)[^\\d]*(\\d+(?:\\.\\d+)?)",
            metric_key: "cu_spot_smm",
            unit_multiplier: 1,
            group: 1
          }
        ]
      }
    });

    expect(result.success).toBe(true);
  });

  it("rejects legacy regex rule key naming", () => {
    const result = createSourceSchema.safeParse({
      name: "legacy",
      url: "http://rsshub:1200/smm/news/cu",
      fetcherType: "quotes",
      tier: "T2",
      config: {
        type: "quotes",
        adapter: "rsshub-extract",
        metric_keys: ["cu_spot_smm"],
        endpoint: "/smm/news/cu",
        retry: { max: 2, backoffMs: 1000 },
        regex_rules: [{ pattern: "(\\d+)", key: "cu_spot_smm" }]
      }
    });

    expect(result.success).toBe(false);
  });

  it("accepts crawl config for firecrawl risk search", () => {
    expect(createSourceSchema.safeParse({
      name: "Firecrawl-C1风险检索",
      url: "https://internal.fe-radar/crawl/c1-risk",
      fetcherType: "crawl",
      tier: "T2",
      category: "风险检索",
      config: {
        type: "crawl",
        adapter: "firecrawl",
        queries: ["远东控股 诉讼"],
        limit: 5,
        riskFilter: true,
        entityKeywords: ["远东控股"],
        riskKeywords: ["诉讼"],
        includeDomains: ["www.gov.cn"],
      },
    }).success).toBe(true);
  });

  it("accepts crawl config without riskFilter when keywords are omitted", () => {
    expect(createSourceSchema.safeParse({
      name: "Firecrawl-通用检索",
      url: "https://internal.fe-radar/crawl/generic",
      fetcherType: "crawl",
      tier: "T2",
      config: {
        type: "crawl",
        adapter: "firecrawl",
        queries: ["电线电缆 政策"],
        limit: 5,
        includeDomains: ["www.gov.cn"],
      },
    }).success).toBe(true);
  });

  it("rejects risk-filtered crawl config without database keywords", () => {
    expect(createSourceSchema.safeParse({
      name: "Firecrawl-C1风险检索",
      url: "https://internal.fe-radar/crawl/c1-risk",
      fetcherType: "crawl",
      tier: "T2",
      category: "风险检索",
      config: {
        type: "crawl",
        adapter: "firecrawl",
        queries: ["远东控股 诉讼"],
        limit: 5,
        riskFilter: true,
      },
    }).success).toBe(false);
  });

  it("rejects risk-filtered crawl config without include domains", () => {
    expect(createSourceSchema.safeParse({
      name: "Firecrawl-C1风险检索",
      url: "https://internal.fe-radar/crawl/c1-risk",
      fetcherType: "crawl",
      tier: "T2",
      category: "风险检索",
      config: {
        type: "crawl",
        adapter: "firecrawl",
        queries: ["远东控股 诉讼"],
        limit: 5,
        riskFilter: true,
        entityKeywords: ["远东控股"],
        riskKeywords: ["诉讼"],
      },
    }).success).toBe(false);
  });

  it("accepts announcement config for litigation sources", () => {
    expect(createSourceSchema.safeParse({
      name: "深交所公告-竞品涉诉",
      url: "https://www.szse.cn/disclosure/listed/notice/index.html",
      fetcherType: "announcement",
      tier: "T1",
      category: "上市公司涉诉",
      config: {
        type: "announcement",
        adapter: "szse",
        litigationFilter: true,
        titleKeywords: ["诉讼", "仲裁"],
        stocks: ["000533"],
        pageSize: 50,
      },
    }).success).toBe(true);
  });

  it("rejects announcement config with an unapproved endpoint", () => {
    expect(createSourceSchema.safeParse({
      name: "bad announcement",
      url: "https://example.com/source",
      fetcherType: "announcement",
      tier: "T2",
      category: "上市公司涉诉",
      config: {
        type: "announcement",
        adapter: "szse",
        litigationFilter: true,
        titleKeywords: ["诉讼"],
        endpoint: "http://169.254.169.254/latest/meta-data",
      },
    }).success).toBe(false);
  });
});
