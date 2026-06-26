import { describe, expect, it } from "vitest";
import {
  filterRiskResults,
  mapFirecrawlResultToStandardItem,
  mergeFirecrawlResults,
  resolveIncludeDomains,
} from "../risk-filter";

describe("crawl risk-filter", () => {
  it("maps firecrawl search result to StandardItem", () => {
    const item = mapFirecrawlResultToStandardItem(
      {
        url: "https://news.bjx.com.cn/html/example",
        title: "远东电缆涉诉进展",
        description: "公司回应相关诉讼事项",
        metadata: { publishedTime: "2026-06-10T08:00:00.000Z" },
      },
      500
    );

    expect(item).toMatchObject({
      url: "https://news.bjx.com.cn/html/example",
      title: "远东电缆涉诉进展",
      content: "公司回应相关诉讼事项",
    });
  });

  it("filters to C1 + risk keyword matches", () => {
    const items = [
      {
        title: "远东控股收到行政处罚告知书",
        url: "https://a",
        content: "市场监管局处罚",
        publishedAt: new Date(),
      },
      {
        title: "行业周报",
        url: "https://b",
        content: "远东控股业绩平稳",
        publishedAt: new Date(),
      },
    ];

    expect(filterRiskResults(items, {
      type: "crawl",
      adapter: "firecrawl",
      queries: ["x"],
      riskFilter: true,
      entityKeywords: ["远东控股"],
      riskKeywords: ["行政处罚", "处罚"],
    })).toHaveLength(1);
  });

  it("passes through items when riskFilter is not enabled", () => {
    const items = [
      {
        title: "行业周报",
        url: "https://b",
        content: "无关内容",
        publishedAt: new Date(),
      },
    ];

    expect(filterRiskResults(items, {
      type: "crawl",
      adapter: "firecrawl",
      queries: ["x"],
    })).toEqual(items);
  });

  it("requires risk keywords from source config when riskFilter is enabled", () => {
    expect(() => filterRiskResults([{
      title: "远东控股收到行政处罚告知书",
      url: "https://a",
      content: "市场监管局处罚",
      publishedAt: new Date(),
    }], { type: "crawl", adapter: "firecrawl", queries: ["x"], riskFilter: true })).toThrow("entityKeywords and riskKeywords");
  });

  it("requires includeDomains from source config", () => {
    expect(() => resolveIncludeDomains({ type: "crawl", adapter: "firecrawl", queries: ["x"] })).toThrow("includeDomains");
    expect(resolveIncludeDomains({ type: "crawl", adapter: "firecrawl", queries: ["x"], includeDomains: ["www.gov.cn"] })).toEqual(["www.gov.cn"]);
  });

  it("does not use markdown as content fallback", () => {
    const item = mapFirecrawlResultToStandardItem({
      url: "https://example.com/a",
      title: "标题",
      markdown: "正文不应入库",
    }, 500);

    expect(item?.content).toBe("标题");
  });

  it("dedupes merged results", () => {
    const items = [
      { title: "a", url: "https://a", content: "", publishedAt: new Date() },
      { title: "b", url: "https://a", content: "", publishedAt: new Date() },
    ];
    expect(mergeFirecrawlResults(items)).toHaveLength(1);
  });

  it("excludes pages where URL matches built-in noise pattern (quote.)", () => {
    const items = [
      {
        title: "远东控股行政处罚公告",
        url: "https://quote.eastmoney.com/600869.html",
        content: "远东控股行政处罚",
        publishedAt: new Date(),
      },
      {
        title: "远东控股收到行政处罚告知书",
        url: "https://news.eastmoney.com/article/123.html",
        content: "市场监管局处罚",
        publishedAt: new Date(),
      },
    ];

    const result = filterRiskResults(items, {
      type: "crawl",
      adapter: "firecrawl",
      queries: ["x"],
      riskFilter: true,
      entityKeywords: ["远东控股"],
      riskKeywords: ["行政处罚"],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.url).toContain("news.eastmoney.com");
  });

  it("excludes pages where title has 6-digit stock code + noise keyword (_新浪财经)", () => {
    const items = [
      {
        title: "远东股份(600869)新股发行_新浪财经",
        url: "https://finance.sina.com.cn/600869.html",
        content: "行政处罚进展",
        publishedAt: new Date(),
      },
      {
        title: "远东控股行政处罚公告",
        url: "https://news.bjx.com.cn/article/1.html",
        content: "行政处罚",
        publishedAt: new Date(),
      },
    ];

    const result = filterRiskResults(items, {
      type: "crawl",
      adapter: "firecrawl",
      queries: ["x"],
      riskFilter: true,
      entityKeywords: ["远东"],
      riskKeywords: ["行政处罚"],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.url).toContain("bjx.com.cn");
  });

  it("respects config.excludeUrlPatterns (substring match)", () => {
    const items = [
      {
        title: "远东控股涉诉公告",
        url: "https://guba.eastmoney.com/news,600869,abc.html",
        content: "诉讼",
        publishedAt: new Date(),
      },
      {
        title: "远东控股涉诉公告",
        url: "https://news.bjx.com.cn/2026/06/article.html",
        content: "诉讼",
        publishedAt: new Date(),
      },
    ];

    const result = filterRiskResults(items, {
      type: "crawl",
      adapter: "firecrawl",
      queries: ["x"],
      riskFilter: true,
      entityKeywords: ["远东控股"],
      riskKeywords: ["诉讼"],
      excludeUrlPatterns: ["eastmoney\\.com/news"],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.url).toContain("bjx.com.cn");
  });

  it("respects config.excludeTitlePatterns (substring match, case-insensitive)", () => {
    const items = [
      {
        title: "远东股份行情概览_东方财富",
        url: "https://quote.eastmoney.com/600869",
        content: "诉讼",
        publishedAt: new Date(),
      },
      {
        title: "远东控股收到行政处罚告知书",
        url: "https://news.bjx.com.cn/article/1.html",
        content: "行政处罚",
        publishedAt: new Date(),
      },
    ];

    const result = filterRiskResults(items, {
      type: "crawl",
      adapter: "firecrawl",
      queries: ["x"],
      riskFilter: true,
      entityKeywords: ["远东"],
      riskKeywords: ["行政处罚", "诉讼"],
      excludeTitlePatterns: ["行情概览"],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.url).toContain("bjx.com.cn");
  });

  it("requireRiskKeywordInTitle=true: excludes item where risk keyword is only in content", () => {
    const items = [
      {
        title: "远东控股公告",
        url: "https://news.bjx.com.cn/article/1.html",
        content: "公司收到行政处罚告知书",
        publishedAt: new Date(),
      },
    ];

    const result = filterRiskResults(items, {
      type: "crawl",
      adapter: "firecrawl",
      queries: ["x"],
      riskFilter: true,
      entityKeywords: ["远东控股"],
      riskKeywords: ["行政处罚"],
      requireRiskKeywordInTitle: true,
    });

    expect(result).toHaveLength(0);
  });

  it("requireRiskKeywordInTitle=true: keeps item where risk keyword is in title", () => {
    const items = [
      {
        title: "远东控股收到行政处罚告知书",
        url: "https://news.bjx.com.cn/article/1.html",
        content: "市场监管局最新通知",
        publishedAt: new Date(),
      },
    ];

    const result = filterRiskResults(items, {
      type: "crawl",
      adapter: "firecrawl",
      queries: ["x"],
      riskFilter: true,
      entityKeywords: ["远东控股"],
      riskKeywords: ["行政处罚"],
      requireRiskKeywordInTitle: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.title).toContain("行政处罚");
  });

  it("requireRiskKeywordInTitle=false behaves same as default (risk in content ok)", () => {
    const items = [
      {
        title: "远东控股公告",
        url: "https://news.bjx.com.cn/article/1.html",
        content: "公司收到行政处罚告知书",
        publishedAt: new Date(),
      },
    ];

    const result = filterRiskResults(items, {
      type: "crawl",
      adapter: "firecrawl",
      queries: ["x"],
      riskFilter: true,
      entityKeywords: ["远东控股"],
      riskKeywords: ["行政处罚"],
      requireRiskKeywordInTitle: false,
    });

    expect(result).toHaveLength(1);
  });

  it("strips _新浪财经 site suffix from title in mapFirecrawlResultToStandardItem", () => {
    const item = mapFirecrawlResultToStandardItem(
      {
        url: "https://finance.sina.com.cn/article/1.html",
        title: "远东控股收到行政处罚告知书_新浪财经",
      },
      500
    );

    expect(item?.title).toBe("远东控股收到行政处罚告知书");
  });

  it("strips _东方财富网 site suffix from title", () => {
    const item = mapFirecrawlResultToStandardItem(
      {
        url: "https://eastmoney.com/article/1.html",
        title: "远东控股行政处罚进展_东方财富网",
      },
      500
    );

    expect(item?.title).toBe("远东控股行政处罚进展");
  });

  it("does not strip site suffix when not at end of title", () => {
    const item = mapFirecrawlResultToStandardItem(
      {
        url: "https://news.bjx.com.cn/article/1.html",
        title: "_新浪财经报道了远东控股的行政处罚进展",
      },
      500
    );

    expect(item?.title).toBe("_新浪财经报道了远东控股的行政处罚进展");
  });
});
