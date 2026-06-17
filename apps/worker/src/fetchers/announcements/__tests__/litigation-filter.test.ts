import { describe, expect, it } from "vitest";
import { dedupeStandardItems, filterItemsByTitleKeywords, resolveTitleKeywords } from "../litigation-filter";

describe("litigation-filter", () => {
  it("requires configured keywords when litigationFilter is enabled", () => {
    expect(() => resolveTitleKeywords({ litigationFilter: true })).toThrow("titleKeywords or searchkey");
  });

  it("resolves configured title keywords before searchkey", () => {
    expect(resolveTitleKeywords({ litigationFilter: true, searchkey: "诉讼", titleKeywords: ["仲裁"] })).toEqual(["仲裁"]);
  });

  it("uses searchkey as a configured keyword", () => {
    expect(resolveTitleKeywords({ litigationFilter: true, searchkey: "诉讼" })).toEqual(["诉讼"]);
  });

  it("filters items by title keywords", () => {
    const items = [
      { title: "涉及诉讼的公告", url: "https://a", content: "", publishedAt: new Date() },
      { title: "年度报告", url: "https://b", content: "", publishedAt: new Date() },
    ];
    expect(filterItemsByTitleKeywords(items, ["诉讼"])).toHaveLength(1);
  });

  it("dedupes by url", () => {
    const items = [
      { title: "a", url: "https://a", content: "", publishedAt: new Date() },
      { title: "b", url: "https://a", content: "", publishedAt: new Date() },
    ];
    expect(dedupeStandardItems(items)).toHaveLength(1);
  });
});
