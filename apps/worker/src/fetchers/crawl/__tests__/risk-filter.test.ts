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
});
