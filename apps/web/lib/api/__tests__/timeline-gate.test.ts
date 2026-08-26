import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@fe-radar/shared", () => ({
  APP_TIMEZONE: "Asia/Shanghai",
  dayjs: () => ({ tz: () => ({ toDate: () => new Date() }) })
}));

vi.mock("@/lib/mock-mode", () => ({ isMockMode: () => false }));
vi.mock("@/lib/api/cursor", () => ({
  decodeCursor: () => null,
  encodeCursor: (value: unknown) => JSON.stringify(value)
}));
vi.mock("@/lib/api/item-visibility", () => ({
  BLOCKED_QUOTA_STATES: ["blocked"],
  MANUAL_SCRUB_SUMMARY: "__scrubbed__"
}));
vi.mock("@/lib/mock-data", () => ({
  mockFetchItemDetail: vi.fn(),
  mockFetchTimeline: vi.fn()
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ $and: args.filter(Boolean) }),
  or: (...args: unknown[]) => ({ $or: args.filter(Boolean) }),
  eq: (a: unknown, b: unknown) => ({ $eq: [a, b] }),
  ne: (a: unknown, b: unknown) => ({ $ne: [a, b] }),
  lt: (a: unknown, b: unknown) => ({ $lt: [a, b] }),
  desc: (a: unknown) => ({ $desc: a }),
  ilike: (a: unknown, b: unknown) => ({ $ilike: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ $inArray: [a, b] }),
  isNull: (a: unknown) => ({ $isNull: a }),
  isNotNull: (a: unknown) => ({ $isNotNull: a }),
  not: (a: unknown) => ({ $not: a }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      $sql: String.raw(strings, ...values.map(() => "?"))
    }),
    { raw: (value: string) => ({ $sqlRaw: value }) }
  )
}));

const {
  mockGetDb,
  mockItemAnalysis,
  mockItems,
  mockSources,
  mockClusters,
  mockClusterItems,
  mockEntities,
  mockItemEntities
} = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockItemAnalysis: {
    scoredAt: "ia.scored_at",
    quotaState: "ia.quota_state",
    summaryZh: "ia.summary_zh",
    isCurated: "ia.is_curated",
    category: "ia.category",
    topCircle: "ia.top_circle",
    alertType: "ia.alert_type",
    alertLevel: "ia.alert_level",
    qualityScore: "ia.quality_score",
    translationZh: "ia.translation_zh",
    d1Policy: "ia.d1",
    d2Chain: "ia.d2",
    d3Market: "ia.d3",
    d4Tech: "ia.d4",
    d5Business: "ia.d5",
    isIndustryRelated: "ia.is_industry_related",
    itemId: "ia.item_id"
  },
  mockItems: {
    id: "items.id",
    title: "items.title",
    url: "items.url",
    publishedAt: "items.published_at",
    content: "items.content",
    sourceId: "items.source_id"
  },
  mockSources: {
    id: "sources.id",
    name: "sources.name",
    tier: "sources.tier",
    category: "sources.category",
    fetcherType: "sources.fetcher_type"
  },
  mockClusters: {
    id: "clusters.id",
    leadItemId: "clusters.lead_item_id",
    eventType: "clusters.event_type"
  },
  mockClusterItems: {
    id: "ci.id",
    itemId: "ci.item_id",
    clusterId: "ci.cluster_id",
    similarity: "ci.similarity"
  },
  mockEntities: {
    id: "e.id",
    type: "e.type",
    canonicalName: "e.name",
    circle: "e.circle"
  },
  mockItemEntities: {
    itemId: "ie.item_id",
    entityId: "ie.entity_id",
    span: "ie.span"
  }
}));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  items: mockItems,
  itemAnalysis: mockItemAnalysis,
  sources: mockSources,
  clusters: mockClusters,
  clusterItems: mockClusterItems,
  entities: mockEntities,
  itemEntities: mockItemEntities
}));

import {
  fetchCuratedCategoryStats,
  fetchItemDetail,
  fetchTimeline
} from "../timeline-query";

function makeQueryBuilder(rows: unknown[]) {
  const whereFn = vi.fn().mockReturnValue({
    orderBy: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue(rows)
    })
  });
  const chain = {
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: whereFn
  };
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue(chain)
    }),
    _where: whereFn
  };
  mockGetDb.mockReturnValue(db);
  return db;
}

describe("行业闸门 visibleItemConditions（通过 fetchTimeline 注入 db）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function getWhereArg(db: ReturnType<typeof makeQueryBuilder>) {
    return db._where.mock.calls[0]?.[0];
  }

  function hasIndustrySqlCondition(whereArg: unknown): boolean {
    return JSON.stringify(whereArg).includes("IS NOT FALSE");
  }

  it("① isIndustryRelated=false 的条目会被行业闸门（IS NOT FALSE）排除", async () => {
    const db = makeQueryBuilder([]);
    await fetchTimeline({ db: db as never, filters: {} });
    const whereArg = getWhereArg(db);
    expect(hasIndustrySqlCondition(whereArg)).toBe(true);
  });

  it("② includeNonIndustry=false（默认）时，WHERE 包含行业闸门 SQL 条件", async () => {
    const db = makeQueryBuilder([]);
    await fetchTimeline({ db: db as never, filters: {}, includeNonIndustry: false });
    const whereArg = getWhereArg(db);
    expect(hasIndustrySqlCondition(whereArg)).toBe(true);
  });

  it("③ includeNonIndustry=true 时，WHERE 不包含行业闸门 SQL 条件（全展示）", async () => {
    const db = makeQueryBuilder([]);
    await fetchTimeline({ db: db as never, filters: {}, includeNonIndustry: true });
    const whereArg = getWhereArg(db);
    expect(hasIndustrySqlCondition(whereArg)).toBe(false);
  });

  it("④ 行业闸门 SQL 包含 topCircle IN (C1,C2) 豁免", async () => {
    const db = makeQueryBuilder([]);
    await fetchTimeline({ db: db as never, filters: {} });
    const s = JSON.stringify(getWhereArg(db));
    expect(s).toContain("C1");
    expect(s).toContain("C2");
  });

  it("⑤ 行业闸门 SQL 仅 own/legal/risk 走 alertType 豁免（T-RR-02 收紧）", async () => {
    const db = makeQueryBuilder([]);
    await fetchTimeline({ db: db as never, filters: {} });
    const s = JSON.stringify(getWhereArg(db));
    // Exemption restricted from blanket IS NOT NULL to own/legal/risk only.
    expect(s).toContain("own");
    expect(s).toContain("legal");
    expect(s).toContain("risk");
    // Sanity: the legacy blanket IS NOT NULL exemption is gone.
    expect(s).not.toMatch(/alertType\)?\s*IS NOT NULL/);
    expect(s).not.toMatch(/alertType.*IN \('own','legal','risk','safety','policy'\)/);
  });
  it("⑥ fetchItemDetail 不受行业闸门限制（IS NOT FALSE 不在 where 中）", async () => {
    const db = makeQueryBuilder([]);
    const limitFn = vi.fn().mockResolvedValue([]);
    const whereDetailFn = vi.fn().mockReturnValue({ limit: limitFn });
    const chain = {
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: whereDetailFn
    };
    db.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue(chain)
    });
    mockGetDb.mockReturnValue(db);

    await fetchItemDetail(99, { db: db as never });

    const whereArg = whereDetailFn.mock.calls[0]?.[0];
    expect(hasIndustrySqlCondition(whereArg)).toBe(false);
  });

  it("⑦ fetchItemDetail 返回 null 而非抛错（不 404）当条目被列表闸门隐藏", async () => {
    const limitFn = vi.fn().mockResolvedValue([]);
    const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
    const chain = {
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: whereFn
    };
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue(chain)
      })
    };
    mockGetDb.mockReturnValue(db);

    const result = await fetchItemDetail(404, { db: db as never });

    expect(result).toBeNull();
  });
});

describe("T-PERF-01 search uses items_fts_idx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function getWhereArg(db: ReturnType<typeof makeQueryBuilder>, call = 0) {
    return db._where.mock.calls[call]?.[0];
  }

  it("fetchTimeline({ search }) FTS path matches GIN and does not OR ILIKE", async () => {
    const db = makeQueryBuilder([]);
    await fetchTimeline({ db: db as never, search: "电缆" });
    const whereArg = getWhereArg(db);
    const s = JSON.stringify(whereArg);

    expect(s).toContain("to_tsvector('zhparser'");
    expect(s).toContain("plainto_tsquery('zhparser'");

    const ftsSql = s.match(/to_tsvector\('zhparser'[^"]*/)?.[0] ?? "";
    expect(ftsSql).toContain(
      "coalesce(?, '') || ' ' || coalesce(?, '')"
    );
    expect(ftsSql).not.toMatch(/summary_zh|summaryZh/);

    expect(s).not.toContain("$ilike");
    expect(s).not.toMatch(/"\$ilike":\["items\.content"/);
  });

  it("FTS throw retries with title+summary ILIKE and never content ILIKE", async () => {
    const db = makeQueryBuilder([]);
    const limit = vi
      .fn()
      .mockRejectedValueOnce(new Error("zhparser unavailable"))
      .mockResolvedValueOnce([]);
    db._where.mockReturnValue({
      orderBy: vi.fn().mockReturnValue({ limit })
    });

    await fetchTimeline({ db: db as never, search: "电缆" });

    expect(db._where).toHaveBeenCalledTimes(2);
    const fallback = JSON.stringify(getWhereArg(db, 1));
    expect(fallback).not.toContain("to_tsvector");
    expect(fallback).toContain('"$ilike":["items.title"');
    expect(fallback).toContain('"$ilike":["ia.summary_zh"');
    expect(fallback).not.toMatch(/"\$ilike":\["items\.content"/);
  });
});

describe("精选分类聚合", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("单次聚合返回真实计数并为无数据分类补零，不应用 200 条 limit", async () => {
    const groupBy = vi
      .fn()
      .mockResolvedValue([
        { category: "政策与标准", count: 237, topScore: 96.5 }
      ]);
    const where = vi.fn().mockReturnValue({ groupBy });
    const chain = {
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where
    };
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue(chain)
      })
    };

    const result = await fetchCuratedCategoryStats(["policy", "market"], {
      db: db as never
    });

    expect(result).toEqual([
      { category: "policy", count: 237, topScore: 96.5 },
      { category: "market", count: 0, topScore: null }
    ]);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith(mockItemAnalysis.category);
    expect(JSON.stringify(where.mock.calls[0]?.[0])).toContain("ia.is_curated");
    expect(JSON.stringify(where.mock.calls[0]?.[0])).toContain("IS NOT FALSE");
  });
});
