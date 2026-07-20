import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FeRadarShared from "@fe-radar/shared";

const {
  mockGetDb,
  mockMarkSourceSuccess,
  mockRecordSourceFailure,
  mockFetchAnnouncements,
  mockEnqueueItemPipeline,
  mockFlowProducer,
  mockRedis,
  mockFetchQueueClose,
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
    mockFlowProducer: vi.fn(function () {
      return { close: vi.fn().mockResolvedValue(undefined) };
    }),
    mockRedis: { quit: vi.fn().mockResolvedValue(undefined) },
    mockFetchQueueClose: vi.fn().mockResolvedValue(undefined),
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
  createFetchQueue: vi.fn(() => ({ close: mockFetchQueueClose })),
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
vi.mock("../jobs/quota-drain", () => ({
  drainPendingQuotaBacklog: vi.fn().mockResolvedValue({ expired: 0, readmitted: 0, stillPending: 0 }),
}));
vi.mock("../lib/entities-dict", () => ({ EntityDictionary: vi.fn() }));
vi.mock("../handlers/context", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  handlerContext: { qwen: {}, deepSeek: {}, kimi: {}, playwrightPool: null },
  loadScoringConfig: vi.fn().mockResolvedValue({
    weights: { w1: 0.2, w2: 0.25, w3: 0.2, w4: 0.15, w5: 0.2 },
    tCoef: { T1: 1, T2: 0.85, T3: 0.7 },
    cCoef: { C1: 1.2, C2: 1, C3: 0.85 },
    thresholds: {},
  }),
  loadOwnCompanyProfile: vi.fn().mockResolvedValue({
    names: new Set(["远东控股", "远东电缆", "远东智慧能源"]),
  }),
}));
vi.mock("@fe-radar/llm", () => ({
  createQwenClient: vi.fn(),
  createDeepSeekClient: vi.fn(),
  createKimiClient: vi.fn(),
  withScrubber: vi.fn((client) => client),
}));
vi.mock("@fe-radar/core", () => ({
  curateItem: vi.fn(),
  admitToScoring: vi.fn().mockResolvedValue({ state: "admitted", counterKey: "k" }),
  detectPriorityFromText: vi.fn().mockReturnValue(false),
}));
vi.mock("@fe-radar/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof FeRadarShared>();
  return {
    ...actual,
    QUEUES: { fetch: "fetch", prefilter: "prefilter", ner: "ner", scorer: "scorer", embedder: "embedder", cluster: "cluster", curator: "curator", daily: "daily" },
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

import { __testables } from "../runner";

function makeDb() {
  let selectCall = 0;
  const dbBase = {
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
  const db = Object.assign(dbBase, {
    transaction: vi.fn(async (cb: (tx: typeof dbBase) => unknown) => cb(dbBase)),
  });
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
    expect(mockEnqueueItemPipeline).toHaveBeenCalledWith(expect.anything(), 101, expect.any(String));
    expect(mockMarkSourceSuccess).toHaveBeenCalledWith(db, 7);
    expect(mockRecordSourceFailure).not.toHaveBeenCalled();
  });

  // Antigravity/Codex #4 — the scheduling cycle (sourceId 0) builds a temporary
  // fetch queue + its own Redis connection; BOTH must be released. Asserting
  // close() alone is insufficient: BullMQ won't quit a passed-in (shared) IORedis,
  // so we must also see conn.quit().
  it("scheduling cycle (sourceId 0) closes the fetch queue AND quits its Redis connection", async () => {
    makeDb();

    await __testables.handleFetchJob({ data: { sourceId: 0 } });

    expect(mockFetchQueueClose).toHaveBeenCalledTimes(1);
    expect(mockRedis.quit).toHaveBeenCalledTimes(1);
  });
});

describe("worker runtime shutdown", () => {
  it("closes workers, queues, Playwright pool, and Redis once", async () => {
    const workerA = { close: vi.fn().mockResolvedValue(undefined) };
    const workerB = { close: vi.fn().mockResolvedValue(undefined) };
    const queue = { close: vi.fn().mockResolvedValue(undefined) };
    const playwrightPool = { close: vi.fn().mockResolvedValue(undefined) };
    const connection = { quit: vi.fn().mockResolvedValue(undefined) };
    const runtime = __testables.createWorkerRuntime({
      workers: [workerA, workerB],
      queues: [queue],
      connection,
      getPlaywrightPool: () => playwrightPool,
      logger: { info: vi.fn() },
    });

    await Promise.all([runtime.shutdown("SIGTERM"), runtime.shutdown("SIGINT")]);

    expect(workerA.close).toHaveBeenCalledTimes(1);
    expect(workerB.close).toHaveBeenCalledTimes(1);
    expect(queue.close).toHaveBeenCalledTimes(1);
    expect(playwrightPool.close).toHaveBeenCalledTimes(1);
    expect(connection.quit).toHaveBeenCalledTimes(1);
  });
});
