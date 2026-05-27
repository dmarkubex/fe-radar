import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetDb,
  mockMarkSourceSuccess,
  mockRecordSourceFailure,
  mockFetchAnnouncements,
  mockEnqueueItemPipeline,
  mockFlowProducer,
  mockRedis,
  mockSource,
  mockItems,
  mockItemAnalysis,
  mockSources,
} = vi.hoisted(() => {
  const mockSource = {
    id: 7,
    name: "交易所公告",
    enabled: true,
    failCount: 0,
    config: { type: "announcement", adapter: "stub-announcement-adapter" },
  };
  return {
    mockGetDb: vi.fn(),
    mockMarkSourceSuccess: vi.fn().mockResolvedValue(undefined),
    mockRecordSourceFailure: vi.fn().mockResolvedValue(undefined),
    mockFetchAnnouncements: vi.fn(),
    mockEnqueueItemPipeline: vi.fn().mockResolvedValue(undefined),
    mockFlowProducer: vi.fn(),
    mockRedis: { quit: vi.fn() },
    mockSource,
    mockItems: { id: "items.id", sourceId: "items.source_id", url: "items.url", title: "items.title", publishedAt: "items.published_at" },
    mockItemAnalysis: { itemId: "item_analysis.item_id" },
    mockSources: { id: "sources.id" },
  };
});

vi.mock("bullmq", () => ({
  Worker: vi.fn(),
  Queue: vi.fn(),
  FlowProducer: mockFlowProducer,
}));

vi.mock("../index", () => ({ workerName: "test-worker" }));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  items: mockItems,
  itemAnalysis: mockItemAnalysis,
  itemEntities: {},
  clusterItems: {},
  clusters: {},
  entities: {},
  scoringConfig: {},
  sources: mockSources,
  markSourceSuccess: mockMarkSourceSuccess,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
  and: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => `${strings.join("?")}${values.join(",")}`),
}));

vi.mock("../scheduler", () => ({
  enqueueEnabledSources: vi.fn(),
  recordSourceFailure: mockRecordSourceFailure,
  enqueueEnabledQuotesSources: vi.fn(),
  scheduleQuotesFetchCron: vi.fn(),
  scheduleBriefingPushCron: vi.fn(),
  FETCH_CONCURRENCY: 1,
}));

vi.mock("../queues", () => ({
  createRedisConnection: vi.fn(() => mockRedis),
  createFetchQueue: vi.fn(),
  FETCH_SCHEDULE_CRON: "0 */6 * * *",
  FETCH_SCHEDULE_TZ: "Asia/Shanghai",
  DAILY_REPORT_SCHEDULE_CRON: "0 8 * * *",
  DAILY_REPORT_SCHEDULE_TZ: "Asia/Shanghai",
  DEFAULT_JOB_OPTIONS: {},
  QUEUE_QUOTES_FETCH: "quotes",
  QUEUE_BRIEFING_GEN: "briefing-gen",
  BRIEFING_GEN_SCHEDULE_CRON: "0 16 * * *",
  BRIEFING_GEN_SCHEDULE_TZ: "Asia/Shanghai",
  QUEUE_BRIEFING_PUSH: "briefing-push",
}));

vi.mock("../fetchers", () => ({
  fetchRss: vi.fn(),
  fetchHtml: vi.fn(),
  fetchPlaywright: vi.fn(),
  fetchAnnouncements: mockFetchAnnouncements,
}));

vi.mock("../fetchers/playwright", () => ({
  createPlaywrightPool: vi.fn(),
}));

vi.mock("../dedup", () => ({
  dedupItems: vi.fn((candidates) => ({ accepted: candidates })),
}));

vi.mock("../flows", () => ({
  enqueueItemPipeline: mockEnqueueItemPipeline,
}));

vi.mock("../jobs/prefilter", () => ({ runPrefilter: vi.fn() }));
vi.mock("../jobs/scorer", () => ({ runScorer: vi.fn() }));
vi.mock("../jobs/ner", () => ({ runNer: vi.fn() }));
vi.mock("../jobs/embedder", () => ({ runEmbedder: vi.fn() }));
vi.mock("../jobs/cluster", () => ({ withClusterCreateLock: vi.fn() }));
vi.mock("../jobs/daily-gen", () => ({ runDailyGen: vi.fn() }));
vi.mock("../jobs/cleanup", () => ({
  runCleanup: vi.fn(),
  CLEANUP_SCHEDULE_CRON: "0 3 * * *",
  CLEANUP_SCHEDULE_TZ: "Asia/Shanghai",
}));
vi.mock("../jobs/quotes-fetch", () => ({ runQuotesFetch: vi.fn() }));
vi.mock("../jobs/briefing-gen", () => ({ runBriefingGen: vi.fn() }));
vi.mock("../jobs/briefing-push", () => ({ runBriefingPush: vi.fn(), scheduleLatestBriefingPush: vi.fn() }));
vi.mock("../lib/entities-dict", () => ({ EntityDictionary: vi.fn() }));
vi.mock("@fe-radar/llm", () => ({
  createQwenClient: vi.fn(),
  createDeepSeekClient: vi.fn(),
  createKimiClient: vi.fn(),
  withScrubber: vi.fn((client) => client),
}));
vi.mock("@fe-radar/core", () => ({ curateItem: vi.fn() }));
vi.mock("@fe-radar/shared", () => ({
  QUEUES: { fetch: "fetch", prefilter: "prefilter", ner: "ner", scorer: "scorer", embedder: "embedder", cluster: "cluster", curator: "curator", daily: "daily" },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { __testables } from "../runner";

function makeDb() {
  let selectCall = 0;
  const db = {
    select: vi.fn(() => {
      selectCall += 1;
      if (selectCall === 1) {
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([mockSource]),
            })),
          })),
        };
      }
      return {
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      };
    }),
    insert: vi.fn((table) => {
      if (table === mockItems) {
        return {
          values: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ id: 101 }]),
          })),
        };
      }
      if (table === mockItemAnalysis) {
        return {
          values: vi.fn().mockResolvedValue(undefined),
        };
      }
      throw new Error("unexpected insert table");
    }),
  };
  mockGetDb.mockReturnValue(db);
  return db;
}

describe("handleFetchJob announcement routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchAnnouncements.mockResolvedValue([
      {
        title: "远东股份公告",
        url: "https://example.com/a",
        content: "公告摘要",
        publishedAt: new Date("2026-05-20T00:00:00.000Z"),
      },
    ]);
  });

  it("routes announcement sources through fetchAnnouncements and enqueues the StandardItem pipeline", async () => {
    const db = makeDb();

    await __testables.handleFetchJob({ data: { sourceId: 7 } });

    expect(mockFetchAnnouncements).toHaveBeenCalledWith(
      { type: "announcement", adapter: "stub-announcement-adapter" },
      { sourceName: "交易所公告", useRealUa: false }
    );
    expect(db.insert).toHaveBeenCalledWith(mockItems);
    expect(db.insert).toHaveBeenCalledWith(mockItemAnalysis);
    expect(mockEnqueueItemPipeline).toHaveBeenCalledWith(expect.anything(), 101);
    expect(mockMarkSourceSuccess).toHaveBeenCalledWith(db, 7);
    expect(mockRecordSourceFailure).not.toHaveBeenCalled();
  });
});
