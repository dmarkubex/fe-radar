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
});
