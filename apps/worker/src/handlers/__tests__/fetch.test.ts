import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetDb,
  mockFetchRss,
  mockDedupItems,
  mockEnqueueEnabledSources,
  mockRecordSourceFailure,
  mockMarkSourceSuccess
} = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockFetchRss: vi.fn(),
  mockDedupItems: vi.fn(),
  mockEnqueueEnabledSources: vi.fn(),
  mockRecordSourceFailure: vi.fn(),
  mockMarkSourceSuccess: vi.fn()
}));

vi.mock("node:crypto", () => ({ randomUUID: () => "test-uuid" }));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  items: {
    id: "items.id",
    sourceId: "items.source_id",
    url: "items.url",
    title: "items.title",
    content: "items.content",
    publishedAt: "items.published_at"
  },
  itemAnalysis: {
    itemId: "ia.item_id",
    isIndustryRelated: "ia.is_industry_related",
    quotaState: "ia.quota_state"
  },
  sources: {
    id: "sources.id",
    name: "sources.name",
    enabled: "sources.enabled",
    failCount: "sources.fail_count"
  },
  markSourceSuccess: mockMarkSourceSuccess
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ $eq: [a, b] })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      $sql: String.raw(strings, ...values.map(() => "?"))
    }),
    { raw: (value: string) => ({ $sqlRaw: value }) }
  )
}));

vi.mock("../../scheduler", () => ({
  enqueueEnabledSources: mockEnqueueEnabledSources,
  recordSourceFailure: mockRecordSourceFailure
}));

vi.mock("../../fetchers", () => ({
  fetchRss: mockFetchRss,
  fetchHtml: vi.fn(),
  fetchPlaywright: vi.fn(),
  fetchAnnouncements: vi.fn(),
  fetchCrawl: vi.fn(),
  dataproAdapter: { fetch: vi.fn() }
}));

vi.mock("../../dedup", () => ({
  dedupItems: mockDedupItems
}));

vi.mock("../../fetchers/playwright", () => ({
  createPlaywrightPool: vi.fn()
}));

vi.mock("../../queues", () => ({
  createRedisConnection: vi.fn(() => ({ quit: vi.fn() })),
  createFetchQueue: vi.fn(() => ({ close: vi.fn() }))
}));

vi.mock("../../flows", () => ({
  enqueueItemPipeline: vi.fn()
}));

vi.mock("bullmq", () => ({
  FlowProducer: vi.fn().mockImplementation(() => ({
    close: vi.fn(),
    add: vi.fn()
  }))
}));

vi.mock("../context", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  handlerContext: { qwen: {}, deepSeek: {}, playwrightPool: null }
}));

function makeDb(sourceRow: Record<string, unknown> | null) {
  const insertReturning = vi.fn().mockResolvedValue([{ id: 1 }]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(sourceRow ? [sourceRow] : [])
        })
      })
    }),
    insert: vi.fn().mockReturnValue({ values: insertValues }),
    _insertValues: insertValues,
    _insertReturning: insertReturning
  };
  mockGetDb.mockReturnValue(db);
  return db;
}

import { handleFetchJob } from "../fetch";

describe("handleFetchJob keyword filter (Fix-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkSourceSuccess.mockResolvedValue(undefined);
    mockDedupItems.mockReturnValue({ accepted: [] });
  });

  it("keywordFilter 匹配：命中关键词的 item 保留，全部丢弃时 candidates 为空", async () => {
    const source = {
      id: 10,
      name: "凤凰财经-能源",
      enabled: true,
      failCount: 0,
      config: {
        type: "rss",
        url: "http://example.com/rss",
        keywordFilter: ["电力", "电缆"]
      }
    };
    makeDb(source);

    const rawItems = [
      {
        url: "http://a.com/1",
        title: "美元兑人民币",
        content: "外汇市场波动",
        publishedAt: new Date()
      },
      {
        url: "http://a.com/2",
        title: "电缆行业新动态",
        content: "输配电设备",
        publishedAt: new Date()
      },
      {
        url: "http://a.com/3",
        title: "美股下跌",
        content: "道琼斯指数",
        publishedAt: new Date()
      }
    ];
    mockFetchRss.mockResolvedValue(rawItems);
    mockDedupItems.mockReturnValue({ accepted: [] });

    await handleFetchJob({ data: { sourceId: 10 } as never });

    const candidatesArg = mockDedupItems.mock.calls[0]?.[0] as Array<{
      title: string;
    }>;
    expect(candidatesArg).toHaveLength(1);
    expect(candidatesArg[0].title).toBe("电缆行业新动态");
  });

  it("keywordFilter 为空数组时不过滤（全保留）", async () => {
    const source = {
      id: 11,
      name: "测试源",
      enabled: true,
      failCount: 0,
      config: { type: "rss", url: "http://example.com/rss", keywordFilter: [] }
    };
    makeDb(source);

    const rawItems = [
      {
        url: "http://a.com/1",
        title: "美元兑人民币",
        content: "外汇",
        publishedAt: new Date()
      },
      {
        url: "http://a.com/2",
        title: "电缆行业",
        content: "电力",
        publishedAt: new Date()
      }
    ];
    mockFetchRss.mockResolvedValue(rawItems);
    mockDedupItems.mockReturnValue({ accepted: [] });

    await handleFetchJob({ data: { sourceId: 11 } as never });

    const candidatesArg = mockDedupItems.mock.calls[0]?.[0] as Array<{
      title: string;
    }>;
    expect(candidatesArg).toHaveLength(2);
  });

  it("keywordFilter 缺省（undefined）时不过滤（全保留）", async () => {
    const source = {
      id: 12,
      name: "无关键词源",
      enabled: true,
      failCount: 0,
      config: { type: "rss", url: "http://example.com/rss" }
    };
    makeDb(source);

    const rawItems = [
      {
        url: "http://a.com/1",
        title: "随机新闻A",
        content: "内容A",
        publishedAt: new Date()
      },
      {
        url: "http://a.com/2",
        title: "随机新闻B",
        content: "内容B",
        publishedAt: new Date()
      }
    ];
    mockFetchRss.mockResolvedValue(rawItems);
    mockDedupItems.mockReturnValue({ accepted: [] });

    await handleFetchJob({ data: { sourceId: 12 } as never });

    const candidatesArg = mockDedupItems.mock.calls[0]?.[0] as Array<{
      title: string;
    }>;
    expect(candidatesArg).toHaveLength(2);
  });
});
