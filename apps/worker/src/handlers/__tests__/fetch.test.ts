import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FeRadarCore from "@fe-radar/core";

const {
  mockGetDb,
  mockFetchRss,
  mockDedupItems,
  mockEnqueueEnabledSources,
  mockRecordSourceFailure,
  mockMarkSourceSuccess,
  mockAdmitToScoring,
  mockRollbackAdmit,
  mockEnqueueItemPipeline,
  mockDrainPendingQuotaBacklog,
} = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockFetchRss: vi.fn(),
  mockDedupItems: vi.fn(),
  mockEnqueueEnabledSources: vi.fn(),
  mockRecordSourceFailure: vi.fn(),
  mockMarkSourceSuccess: vi.fn(),
  mockAdmitToScoring: vi.fn(),
  mockRollbackAdmit: vi.fn(),
  mockEnqueueItemPipeline: vi.fn(),
  mockDrainPendingQuotaBacklog: vi.fn(),
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
  and: vi.fn((...conditions: unknown[]) => ({ $and: conditions })),
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
  createRedisConnection: vi.fn(() => ({ quit: vi.fn(), eval: vi.fn() })),
  createFetchQueue: vi.fn(() => ({ close: vi.fn() }))
}));

vi.mock("../../flows", () => ({
  enqueueItemPipeline: mockEnqueueItemPipeline
}));

vi.mock("../../jobs/quota-drain", () => ({
  drainPendingQuotaBacklog: mockDrainPendingQuotaBacklog
}));

vi.mock("@fe-radar/core", async (importOriginal) => {
  const actual = await importOriginal<typeof FeRadarCore>();
  return {
    ...actual,
    admitToScoring: mockAdmitToScoring,
    rollbackAdmit: mockRollbackAdmit,
  };
});

vi.mock("bullmq", () => ({
  FlowProducer: class {
    close = vi.fn();
    add = vi.fn();
  }
}));

vi.mock("../context", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  handlerContext: { qwen: {}, deepSeek: {}, playwrightPool: null },
  loadOwnCompanyProfile: vi.fn().mockResolvedValue({
    names: new Set(["远东控股", "远东控股集团", "远东电缆", "远东智慧能源", "远东智慧能源股份", "远东股份", "远东智慧"]),
  }),
}));

function makeDb(sourceRow: Record<string, unknown> | null) {
  const insertReturning = vi.fn().mockResolvedValue([{ id: 1 }]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
  const whereResult = {
    limit: vi.fn().mockResolvedValue(sourceRow ? [sourceRow] : []),
    // existing-items query awaits where() directly (no limit)
    then: undefined as unknown,
  };
  // Make where() thenable so `await db.select().from().where()` resolves to []
  const whereFn = vi.fn().mockImplementation(() => {
    const result = Object.assign([], {
      limit: whereResult.limit,
    });
    return result;
  });
  // First select is source lookup with limit; subsequent may be existing fingerprints
  let selectCount = 0;
  const dbBase = {
    select: vi.fn().mockImplementation(() => {
      selectCount += 1;
      if (selectCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(sourceRow ? [sourceRow] : []),
            }),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: whereFn,
        }),
      };
    }),
    insert: vi.fn().mockReturnValue({ values: insertValues }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    _insertValues: insertValues,
    _insertReturning: insertReturning,
  };
  const db = Object.assign(dbBase, {
    transaction: vi.fn(async (cb: (tx: typeof dbBase) => unknown) => cb(dbBase)),
  });
  mockGetDb.mockReturnValue(db);
  return db;
}

import { handleFetchJob } from "../fetch";

describe("handleFetchJob keyword filter (Fix-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkSourceSuccess.mockResolvedValue(undefined);
    mockDedupItems.mockReturnValue({ accepted: [] });
    mockAdmitToScoring.mockResolvedValue({ state: "admitted", counterKey: "k" });
    mockRollbackAdmit.mockResolvedValue(undefined);
    mockEnqueueItemPipeline.mockResolvedValue(undefined);
    mockDrainPendingQuotaBacklog.mockResolvedValue({ expired: 0, readmitted: 0, stillPending: 0 });
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
    expect(candidatesArg[0]?.title).toBe("电缆行业新动态");
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

describe("handleFetchJob quota admit (C0)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkSourceSuccess.mockResolvedValue(undefined);
    mockAdmitToScoring.mockResolvedValue({ state: "admitted", counterKey: "k" });
    mockRollbackAdmit.mockResolvedValue(undefined);
    mockEnqueueItemPipeline.mockResolvedValue(undefined);
    mockDrainPendingQuotaBacklog.mockResolvedValue({ expired: 0, readmitted: 0, stillPending: 0 });
  });

  it("writes real quotaState and skips pipeline when pending_over_quota", async () => {
    const source = {
      id: 20,
      name: "配额测试源",
      enabled: true,
      failCount: 0,
      config: { type: "rss", url: "http://example.com/rss" },
    };
    const db = makeDb(source);
    mockFetchRss.mockResolvedValue([
      {
        url: "http://a.com/1",
        title: "普通行业新闻",
        content: "内容",
        publishedAt: new Date(),
      },
    ]);
    mockDedupItems.mockReturnValue({
      accepted: [
        {
          sourceId: 20,
          url: "http://a.com/1",
          title: "普通行业新闻",
          content: "内容",
          publishedAt: new Date(),
        },
      ],
    });
    mockAdmitToScoring.mockResolvedValue({ state: "pending_over_quota", counterKey: "scoring:counter:normal:2026-07-11" });

    await handleFetchJob({ data: { sourceId: 20 } as never });

    expect(mockAdmitToScoring).toHaveBeenCalled();
    const analysisInsert = db._insertValues.mock.calls.find(
      (call: unknown[]) => (call[0] as { quotaState?: string }).quotaState !== undefined
    );
    expect(analysisInsert?.[0]).toMatchObject({ quotaState: "pending_over_quota" });
    expect(mockEnqueueItemPipeline).not.toHaveBeenCalled();
    expect(mockMarkSourceSuccess).toHaveBeenCalledTimes(1);
  });

  it("drains backlog before scheduling fetch cycle", async () => {
    makeDb(null);
    mockEnqueueEnabledSources.mockResolvedValue(3);

    await handleFetchJob({ data: { sourceId: 0 } as never });

    expect(mockDrainPendingQuotaBacklog).toHaveBeenCalled();
    expect(mockEnqueueEnabledSources).toHaveBeenCalled();
  });

  it("continues scheduling sources when backlog drain lock is unavailable", async () => {
    makeDb(null);
    mockDrainPendingQuotaBacklog.mockRejectedValue(new Error("lock held"));
    mockEnqueueEnabledSources.mockResolvedValue(3);

    await handleFetchJob({ data: { sourceId: 0 } as never });

    expect(mockEnqueueEnabledSources).toHaveBeenCalledTimes(1);
  });

  it("writes analysis before enqueue and compensates quota when enqueue fails", async () => {
    const source = {
      id: 21,
      name: "配额回滚测试源",
      enabled: true,
      failCount: 0,
      config: { type: "rss", url: "http://example.com/rss" },
    };
    const db = makeDb(source);
    const accepted = {
      sourceId: 21,
      url: "http://a.com/rollback",
      title: "远东电缆公告",
      content: "内容",
      publishedAt: new Date(),
    };
    mockFetchRss.mockResolvedValue([accepted]);
    mockDedupItems.mockReturnValue({ accepted: [accepted] });
    mockEnqueueItemPipeline.mockRejectedValueOnce(new Error("bullmq down"));

    await handleFetchJob({ data: { sourceId: 21 } as never });

    const analysisCallIndex = db._insertValues.mock.calls.findIndex(
      (call: unknown[]) => (call[0] as { quotaState?: string }).quotaState === "admitted",
    );
    expect(db._insertValues.mock.invocationCallOrder[analysisCallIndex]).toBeLessThan(
      mockEnqueueItemPipeline.mock.invocationCallOrder[0]!,
    );
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(mockRollbackAdmit).toHaveBeenCalledWith("k", expect.anything());
    expect(mockMarkSourceSuccess).not.toHaveBeenCalled();
  });

  it("rolls back an admit failure and continues the remaining batch", async () => {
    const source = {
      id: 22,
      name: "事务回滚测试源",
      enabled: true,
      failCount: 0,
      config: { type: "rss", url: "http://example.com/rss" },
    };
    const db = makeDb(source);
    const accepted = [
      { sourceId: 22, url: "http://a.com/fail", title: "第一条", content: "内容", publishedAt: new Date() },
      { sourceId: 22, url: "http://a.com/ok", title: "第二条", content: "内容", publishedAt: new Date() },
    ];
    mockFetchRss.mockResolvedValue(accepted);
    mockDedupItems.mockReturnValue({ accepted });
    db._insertReturning
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ id: 2 }]);
    mockAdmitToScoring.mockRejectedValueOnce(new Error("redis down"));

    await handleFetchJob({ data: { sourceId: 22 } as never });

    const analysisCalls = db._insertValues.mock.calls.filter(
      (call: unknown[]) => (call[0] as { quotaState?: string }).quotaState !== undefined,
    );
    expect(analysisCalls).toHaveLength(1);
    expect(analysisCalls[0]?.[0]).toMatchObject({ itemId: 2, quotaState: "admitted" });
    expect(mockAdmitToScoring).toHaveBeenCalledTimes(2);
    expect(mockEnqueueItemPipeline).toHaveBeenCalledWith(expect.anything(), 2, "test-uuid");
    expect(mockMarkSourceSuccess).not.toHaveBeenCalled();
  });

  it("rolls back admitted quota when the analysis insert fails", async () => {
    const source = {
      id: 23,
      name: "分析写入失败测试源",
      enabled: true,
      failCount: 0,
      config: { type: "rss", url: "http://example.com/rss" },
    };
    const db = makeDb(source);
    const accepted = {
      sourceId: 23,
      url: "http://a.com/analysis-fail",
      title: "远东电缆公告",
      content: "内容",
      publishedAt: new Date(),
    };
    mockFetchRss.mockResolvedValue([accepted]);
    mockDedupItems.mockReturnValue({ accepted: [accepted] });
    db._insertValues.mockImplementation((values: { quotaState?: string }) => {
      if (values.quotaState !== undefined) return Promise.reject(new Error("db disconnected"));
      return { returning: db._insertReturning };
    });

    await handleFetchJob({ data: { sourceId: 23 } as never });

    expect(mockEnqueueItemPipeline).not.toHaveBeenCalled();
    expect(mockRollbackAdmit).toHaveBeenCalledWith("k", expect.anything());
    expect(mockMarkSourceSuccess).not.toHaveBeenCalled();
  });
});
