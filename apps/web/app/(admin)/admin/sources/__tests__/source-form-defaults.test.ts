import { describe, expect, it } from "vitest";
import { LITIGATION_SOURCE_CATEGORY } from "@fe-radar/core";
import { createSourceSchema } from "../../../../../lib/api/sources-schema";
import { DEFAULT_SOURCE_CATEGORIES, DEFAULT_SOURCE_CONFIGS } from "../source-default-configs";

describe("source form defaults", () => {
  it("creates a valid crawl config with database-managed risk keywords", () => {
    expect(createSourceSchema.safeParse({
      name: "Firecrawl-C1风险检索",
      url: "https://internal.fe-radar/crawl/c1-risk",
      fetcherType: "crawl",
      tier: "T2",
      category: DEFAULT_SOURCE_CATEGORIES.crawl,
      config: DEFAULT_SOURCE_CONFIGS.crawl,
    }).success).toBe(true);
  });

  it("keeps announcement source category aligned with legal alert classification", () => {
    expect(DEFAULT_SOURCE_CATEGORIES.announcement).toBe(LITIGATION_SOURCE_CATEGORY);
    expect(createSourceSchema.safeParse({
      name: "深交所公告-竞品涉诉",
      url: "https://www.szse.cn/disclosure/listed/notice/index.html",
      fetcherType: "announcement",
      tier: "T1",
      category: DEFAULT_SOURCE_CATEGORIES.announcement,
      config: DEFAULT_SOURCE_CONFIGS.announcement,
    }).success).toBe(true);
  });
});
