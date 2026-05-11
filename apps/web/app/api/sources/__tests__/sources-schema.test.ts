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
});
