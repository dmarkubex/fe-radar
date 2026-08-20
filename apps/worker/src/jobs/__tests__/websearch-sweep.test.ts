import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FeRadarCore from "@fe-radar/core";

const { mockAdmitWebSearch } = vi.hoisted(() => ({
  mockAdmitWebSearch: vi.fn(),
}));

vi.mock("@fe-radar/core", async (importOriginal) => {
  const actual = await importOriginal<typeof FeRadarCore>();
  return { ...actual, admitWebSearch: mockAdmitWebSearch };
});

import {
  parseSweepConfig,
  runWebsearchSweep,
  WEBSEARCH_SWEEP_CURSOR_KEY,
  WEBSEARCH_SWEEP_SENTINEL_ITEM_ID,
  WEBSEARCH_SWEEP_SOURCE_ID,
} from "../websearch-sweep";
import type { WebsearchEnqueueStats, WebsearchEnqueueTarget, WebsearchEnqueueDeps } from "../websearch-enqueue";

function makeSourceRow(config: unknown) {
  return [{ config }];
}

function makeDb(sourceRows: unknown[], entityRows: unknown[]) {
  let selectCall = 0;
  return {
    select: vi.fn(() => {
      const idx = selectCall++;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => {
            if (idx === 0) {
              return { limit: vi.fn().mockResolvedValue(sourceRows) };
            }
            return {
              orderBy: vi.fn().mockResolvedValue(entityRows),
            };
          }),
        })),
      };
    }),
  };
}

function makeConn(cursor: string | null = "0") {
  return {
    get: vi.fn().mockResolvedValue(cursor),
    set: vi.fn().mockResolvedValue("OK"),
    decr: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue(undefined),
  };
}

function makeQueue() {
  return {
    add: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const ENABLED_SWEEP = {
  enabled: true,
  maxPerRun: 14,
  circles: ["C1", "C2"],
};

function companies(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    entityId: i + 1,
    entityName: `公司${i + 1}`,
  }));
}

describe("parseSweepConfig", () => {
  it("returns null when sweep key is missing (default no-op)", () => {
    expect(parseSweepConfig({ type: "websearch" })).toBeNull();
    expect(parseSweepConfig(null)).toBeNull();
  });

  it("reads enabled/maxPerRun/circles from the sweep object", () => {
    expect(parseSweepConfig({ sweep: ENABLED_SWEEP })).toEqual(ENABLED_SWEEP);
  });

  it("treats enabled !== true as disabled", () => {
    expect(parseSweepConfig({ sweep: { ...ENABLED_SWEEP, enabled: false } })?.enabled).toBe(false);
  });
});

describe("runWebsearchSweep", () => {
  const enqueue = vi.fn(async (
    _targets: WebsearchEnqueueTarget[],
    _deps: WebsearchEnqueueDeps,
  ): Promise<WebsearchEnqueueStats> => ({ enqueued: 0, skippedCooldown: 0, skippedQuota: 0 }));

  beforeEach(() => {
    vi.clearAllMocks();
    enqueue.mockResolvedValue({ enqueued: 0, skippedCooldown: 0, skippedQuota: 0 });
    mockAdmitWebSearch.mockResolvedValue({
      state: "admitted",
      counterKey: "websearch:counter:2026-08",
    });
  });

  it("does nothing when source 148 has no sweep key (code-only deploy is a no-op)", async () => {
    const logger = makeLogger();
    const result = await runWebsearchSweep({
      db: makeDb(makeSourceRow({ type: "websearch" }), companies(42)) as never,
      enqueue,
      logger,
    });

    expect(result.enqueued).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        scanned: 0,
        enqueued: 0,
        skippedCooldown: 0,
        skippedQuota: 0,
        cursor: 0,
      }),
      "websearch sweep completed",
    );
  });

  it("does nothing when sweep.enabled is false", async () => {
    const result = await runWebsearchSweep({
      db: makeDb(
        makeSourceRow({ sweep: { ...ENABLED_SWEEP, enabled: false } }),
        companies(42),
      ) as never,
      enqueue,
      logger: makeLogger(),
    });
    expect(result.scanned).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("still enqueues at least one entity when NER C1/C2 hits are zero (2026-08-20 regression)", async () => {
    const conn = makeConn(null);
    const queue = makeQueue();
    const logger = makeLogger();

    const result = await runWebsearchSweep({
      db: makeDb(
        makeSourceRow({ sweep: ENABLED_SWEEP }),
        companies(42),
      ) as never,
      conn,
      queue,
      logger,
      correlationId: "sweep-2026-08-20",
    });

    expect(result.enqueued).toBeGreaterThanOrEqual(1);
    expect(queue.add).toHaveBeenCalled();
    expect(queue.add.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      entityId: 1,
      entityName: "公司1",
      itemId: WEBSEARCH_SWEEP_SENTINEL_ITEM_ID,
      correlationId: "sweep-2026-08-20",
    }));
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        scanned: 14,
        enqueued: expect.any(Number),
        skippedCooldown: expect.any(Number),
        skippedQuota: expect.any(Number),
        cursor: 14,
      }),
      "websearch sweep completed",
    );
  });

  it("rotates from the Redis cursor and wraps around the company list", async () => {
    const conn = makeConn("35");
    enqueue.mockResolvedValue({ enqueued: 14, skippedCooldown: 0, skippedQuota: 0 });

    const result = await runWebsearchSweep({
      db: makeDb(makeSourceRow({ sweep: ENABLED_SWEEP }), companies(42)) as never,
      conn,
      queue: makeQueue(),
      enqueue,
      logger: makeLogger(),
    });

    const [targets] = enqueue.mock.calls[0]!;
    expect(targets.map((t) => t.entityId)).toEqual([
      36, 37, 38, 39, 40, 41, 42, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(result.cursor).toBe(7);
    expect(conn.set).toHaveBeenCalledWith(WEBSEARCH_SWEEP_CURSOR_KEY, "7");
  });

  it("counts cooldown and quota skips from the shared enqueue function", async () => {
    enqueue.mockResolvedValue({ enqueued: 2, skippedCooldown: 10, skippedQuota: 2 });
    const logger = makeLogger();

    const result = await runWebsearchSweep({
      db: makeDb(makeSourceRow({ sweep: ENABLED_SWEEP }), companies(42)) as never,
      conn: makeConn("0"),
      queue: makeQueue(),
      enqueue,
      logger,
    });

    expect(result).toEqual({
      scanned: 14,
      enqueued: 2,
      skippedCooldown: 10,
      skippedQuota: 2,
      cursor: 14,
    });
    expect(logger.info).toHaveBeenCalledWith(result, "websearch sweep completed");
  });

  it("does not throw when the sweep fails; logs error and returns zeros", async () => {
    const logger = makeLogger();
    const db = {
      select: vi.fn(() => {
        throw new Error("db down");
      }),
    };

    await expect(
      runWebsearchSweep({ db: db as never, enqueue, logger }),
    ).resolves.toEqual({
      scanned: 0,
      enqueued: 0,
      skippedCooldown: 0,
      skippedQuota: 0,
      cursor: 0,
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      "websearch sweep failed",
    );
  });

  it("reads source 148 only (sweep config is not hardcoded)", async () => {
    const db = makeDb(makeSourceRow({ sweep: ENABLED_SWEEP }), companies(3));
    await runWebsearchSweep({
      db: db as never,
      conn: makeConn("0"),
      queue: makeQueue(),
      enqueue,
      logger: makeLogger(),
    });
    expect(WEBSEARCH_SWEEP_SOURCE_ID).toBe(148);
    expect(db.select).toHaveBeenCalled();
  });
});
