import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FeRadarCore from "@fe-radar/core";

const {
  mockAdmitToScoring,
  mockRollbackAdmit,
  mockEnqueueItemPipeline,
  mockListSources,
  mockWebsearchAdapterFetch,
  mockGetDb,
  mockDetectPriorityFromText,
} = vi.hoisted(() => ({
  mockAdmitToScoring: vi.fn(),
  mockRollbackAdmit: vi.fn(),
  mockEnqueueItemPipeline: vi.fn(),
  mockListSources: vi.fn(),
  mockWebsearchAdapterFetch: vi.fn(),
  mockGetDb: vi.fn(),
  mockDetectPriorityFromText: vi.fn(),
}));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  listSources: mockListSources,
  items: { id: "items.id", sourceId: "items.source_id", url: "items.url", title: "items.title", content: "items.content", publishedAt: "items.published_at" },
  itemAnalysis: { itemId: "ia.item_id", quotaState: "ia.quota_state" },
}));

vi.mock("@fe-radar/core", async (importOriginal) => {
  const actual = await importOriginal<typeof FeRadarCore>();
  return {
    ...actual,
    admitToScoring: mockAdmitToScoring,
    rollbackAdmit: mockRollbackAdmit,
    detectPriorityFromText: mockDetectPriorityFromText.mockReturnValue(false),
  };
});

vi.mock("../../flows", () => ({ enqueueItemPipeline: mockEnqueueItemPipeline }));

vi.mock("../../queues", () => ({
  createRedisConnection: vi.fn(() => ({ quit: vi.fn() })),
}));

vi.mock("../../handlers/context", () => ({
  loadOwnCompanyProfile: vi.fn().mockResolvedValue({ names: new Set(["远东控股", "远东电缆"]) }),
}));

vi.mock("../../fetchers/websearch/adapter", () => ({
  websearchAdapter: { fetch: mockWebsearchAdapterFetch },
}));

vi.mock("bullmq", () => ({
  FlowProducer: class {
    close = vi.fn();
    add = vi.fn();
  },
}));

import { handleWebsearchJob } from "../websearch";

/** Minimal db mock: insert(items).values().onConflictDoNothing().returning() + insert(itemAnalysis).values() */
function makeDb() {
  let itemInsertCall = 0;
  const insertAnalysisValues = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const dbBase = {
    insert: vi.fn((table: { id?: unknown }) => {
      if (table.id !== undefined) {
        itemInsertCall += 1;
        // items insert
        return {
          values: vi.fn().mockReturnValue({
            onConflictDoNothing: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 99 + itemInsertCall }]),
            }),
          }),
        };
      }
      // itemAnalysis insert
      return { values: insertAnalysisValues };
    }),
    update: vi.fn().mockReturnValue({ set: updateSet }),
    _insertAnalysisValues: insertAnalysisValues,
    _updateSet: updateSet,
  };
  const db = Object.assign(dbBase, {
    transaction: vi.fn(async (cb: (tx: typeof dbBase) => unknown) => cb(dbBase)),
  });
  mockGetDb.mockReturnValue(db);
  return db;
}

const baseJob = {
  entityId: 9,
  entityName: "远东控股",
  itemId: 1,
  correlationId: "corr-1",
} as const;

describe("handleWebsearchJob quota admission (T1, Finding #1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueueItemPipeline.mockResolvedValue(undefined);
    mockRollbackAdmit.mockResolvedValue(undefined);
    mockListSources.mockResolvedValue([{ id: 7, name: "websearch", fetcherType: "websearch", config: {} }]);
    mockWebsearchAdapterFetch.mockResolvedValue([
      { url: "https://ex/a", title: "远东电缆中标", content: "正文", publishedAt: null },
    ]);
    mockDetectPriorityFromText.mockReturnValue(false);
  });

  it("enqueues pipeline and writes admitted analysis when quota admits", async () => {
    makeDb();
    mockAdmitToScoring.mockResolvedValue({ state: "admitted", counterKey: "k" });

    await handleWebsearchJob({ data: baseJob } as never);

    expect(mockAdmitToScoring).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: expect.any(Number), isPriority: false, businessDate: expect.any(String) }),
      expect.anything()
    );
    expect(mockEnqueueItemPipeline).toHaveBeenCalledTimes(1);
  });

  it("skips pipeline and writes pending_over_quota when quota exhausted", async () => {
    const db = makeDb();
    mockAdmitToScoring.mockResolvedValue({ state: "pending_over_quota", counterKey: "k" });

    await handleWebsearchJob({ data: baseJob } as never);

    expect(mockEnqueueItemPipeline).not.toHaveBeenCalled();
    // analysis 仍写入（quotaState=pending_over_quota），留待 quota-drain 重试
    expect(db._insertAnalysisValues).toHaveBeenCalled();
  });

  it("persists admitted analysis before enqueue and rolls back on enqueue failure", async () => {
    const db = makeDb();
    mockAdmitToScoring.mockResolvedValue({ state: "admitted", counterKey: "k" });
    mockEnqueueItemPipeline.mockRejectedValueOnce(new Error("bullmq down"));

    await handleWebsearchJob({ data: baseJob } as never);

    expect(db._insertAnalysisValues).toHaveBeenCalledWith(expect.objectContaining({ quotaState: "admitted" }));
    expect(db._insertAnalysisValues.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnqueueItemPipeline.mock.invocationCallOrder[0]!,
    );
    expect(db._updateSet).toHaveBeenCalledWith({ quotaState: "pending_over_quota" });
    expect(mockRollbackAdmit).toHaveBeenCalledWith("k", expect.anything());
  });

  it("rolls back an admit failure and continues with the next result", async () => {
    const db = makeDb();
    mockWebsearchAdapterFetch.mockResolvedValue([
      { url: "https://ex/fail", title: "第一条", content: "正文", publishedAt: null },
      { url: "https://ex/ok", title: "第二条", content: "正文", publishedAt: null },
    ]);
    mockAdmitToScoring
      .mockRejectedValueOnce(new Error("redis down"))
      .mockResolvedValue({ state: "admitted", counterKey: "k" });

    await handleWebsearchJob({ data: baseJob } as never);

    expect(db._insertAnalysisValues).toHaveBeenCalledTimes(1);
    expect(db._insertAnalysisValues).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 101, quotaState: "admitted" }),
    );
    expect(mockEnqueueItemPipeline).not.toHaveBeenCalledWith(expect.anything(), 100, expect.anything());
    expect(mockEnqueueItemPipeline).toHaveBeenCalledWith(expect.anything(), 101, "corr-1");
    expect(mockAdmitToScoring).toHaveBeenCalledTimes(2);
  });
});
