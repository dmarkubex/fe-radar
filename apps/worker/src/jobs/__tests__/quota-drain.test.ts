import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RedisEvalLike } from "@fe-radar/core";
import type * as FeRadarCore from "@fe-radar/core";
import type * as FeRadarShared from "@fe-radar/shared";

const {
  mockGetDb,
  mockAdmitToScoring,
  mockRollbackAdmit,
  mockEnqueueItemPipeline,
} = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockAdmitToScoring: vi.fn(),
  mockRollbackAdmit: vi.fn(),
  mockEnqueueItemPipeline: vi.fn(),
}));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  items: {
    id: "items.id",
    fetchedAt: "items.fetched_at",
    title: "items.title",
    content: "items.content",
  },
  itemAnalysis: {
    itemId: "ia.item_id",
    quotaState: "ia.quota_state",
  },
}));

vi.mock("@fe-radar/core", async (importOriginal) => {
  const actual = await importOriginal<typeof FeRadarCore>();
  return {
    ...actual,
    admitToScoring: mockAdmitToScoring,
    rollbackAdmit: mockRollbackAdmit,
  };
});

vi.mock("@fe-radar/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof FeRadarShared>();
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock("../../flows", () => ({
  enqueueItemPipeline: mockEnqueueItemPipeline,
}));

vi.mock("../../queues", () => ({
  createRedisConnection: vi.fn(() => ({ quit: vi.fn(), eval: vi.fn() })),
}));

vi.mock("../../handlers/context", () => ({
  // T4: loadOwnCompanyProfile 注入测试用 profile（避免触达 DB entities 查询）
  loadOwnCompanyProfile: vi.fn().mockResolvedValue({
    names: new Set(["远东控股", "远东控股集团", "远东电缆", "远东智慧能源", "远东智慧能源股份", "远东股份", "远东智慧"]),
  }),
}));

vi.mock("bullmq", () => ({
  FlowProducer: class {
    close = vi.fn();
    add = vi.fn();
  },
}));

import { drainPendingQuotaBacklog } from "../quota-drain";

function makeDb(
  pendingRows: Array<{ itemId: number; fetchedAt: Date; title: string; content: string | null }>,
  returningFor: (values: { quotaState: string }) => Array<{ itemId: number }> = () => [{ itemId: 1 }],
) {
  const updateWhere = vi.fn((_: unknown, values: { quotaState: string }) => ({
    returning: vi.fn().mockImplementation(() => returningFor(values)),
  }));
  const updateSet = vi.fn((values: { quotaState: string }) => ({
    where: (condition: unknown) => updateWhere(condition, values),
  }));
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(pendingRows),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({ set: updateSet }),
    _updateSet: updateSet,
    _updateWhere: updateWhere,
  };
  mockGetDb.mockReturnValue(db);
  return db;
}

/**
 * T2（Finding #2）：drainPendingQuotaBacklog 现在用 withQuotaDrainLock 包裹临界区，
 * 锁获取/释放都走 redis.eval（SET NX PX acquire Lua / GET-DEL release Lua）。
 * 这个 eval mock：acquire（脚本含 "SET"）返回 1（拿到锁），release（含 "GET"/"DEL"）返回 1（释放成功）。
 * 对其它 eval 调用（admitToScoring 是被 mock 的，不会真的走 redis.eval）兜底返回 0。
 */
function makeLockRedis(): RedisEvalLike {
  return {
    eval: vi.fn(async (script: string) => (script.includes("SET") || script.includes("DEL") ? 1 : 0)),
  };
}

describe("drainPendingQuotaBacklog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueueItemPipeline.mockResolvedValue(undefined);
    mockRollbackAdmit.mockResolvedValue(undefined);
  });

  it("ages out backlog older than 7 days", async () => {
    const db = makeDb([
      {
        itemId: 1,
        fetchedAt: new Date("2026-05-01T00:00:00Z"),
        title: "旧条目",
        content: null,
      },
      {
        itemId: 2,
        fetchedAt: new Date("2026-05-10T00:00:00Z"),
        title: "远东电缆中标",
        content: null,
      },
    ]);
    mockAdmitToScoring.mockResolvedValue({ state: "admitted", counterKey: "k" });

    const result = await drainPendingQuotaBacklog({
      db: db as never,
      redis: makeLockRedis(),
      flowProducer: { close: vi.fn(), add: vi.fn() } as never,
      now: new Date("2026-05-11T00:00:00Z"),
    });

    expect(result.expired).toBe(1);
    expect(result.readmitted).toBe(1);
    expect(db.update).toHaveBeenCalled();
    expect(mockEnqueueItemPipeline).toHaveBeenCalledWith(expect.anything(), 2, expect.any(String));
  });

  // T3（Finding #3）：原 "stops when admit returns pending_over_quota" 测试把 break bug 固化成预期，
  // 已删除。改为验证 priority 穿透：normal 配额耗尽不应中断对后续 priority 条目的判定。
  it("continues past over-quota items to admit later items (no priority starvation)", async () => {
    const db = makeDb([
      {
        itemId: 3,
        fetchedAt: new Date("2026-05-10T00:00:00Z"),
        title: "普通新闻",   // normal，admit 返回 pending_over_quota
        content: null,
      },
      {
        itemId: 4,
        fetchedAt: new Date("2026-05-10T01:00:00Z"),
        title: "远东电缆中标", // priority（命中本公司），admit 返回 admitted
        content: null,
      },
      {
        itemId: 5,
        fetchedAt: new Date("2026-05-10T02:00:00Z"),
        title: "另一条普通",   // normal，admit 返回 admitted
        content: null,
      },
    ]);
    // item3（normal）→ pending_over_quota；item4/5 → admitted
    mockAdmitToScoring.mockImplementation(({ itemId }) =>
      itemId === 3
        ? Promise.resolve({ state: "pending_over_quota", counterKey: "k" })
        : Promise.resolve({ state: "admitted", counterKey: "k" })
    );

    const result = await drainPendingQuotaBacklog({
      db: db as never,
      redis: makeLockRedis(),
      flowProducer: { close: vi.fn(), add: vi.fn() } as never,
      now: new Date("2026-05-11T00:00:00Z"),
    });

    // item4、item5 入队；item3 仍 pending（不被 break 饿死）
    expect(result.readmitted).toBe(2);
    expect(mockEnqueueItemPipeline).toHaveBeenCalledTimes(2);
    expect(mockEnqueueItemPipeline).toHaveBeenCalledWith(expect.anything(), 4, expect.any(String));
    expect(mockEnqueueItemPipeline).toHaveBeenCalledWith(expect.anything(), 5, expect.any(String));
  });

  // T2（Finding #2）：enqueue 失败时条目保持 pending_over_quota，不被 update 成 admitted（无僵尸）。
  it("leaves item pending_over_quota when enqueue fails (no zombie admitted)", async () => {
    const db = makeDb([
      {
        itemId: 6,
        fetchedAt: new Date("2026-05-10T00:00:00Z"),
        title: "远东电缆",
        content: null,
      },
    ]);
    mockAdmitToScoring.mockResolvedValue({ state: "admitted", counterKey: "k" });
    mockEnqueueItemPipeline.mockRejectedValueOnce(new Error("redis down"));

    const result = await drainPendingQuotaBacklog({
      db: db as never,
      redis: makeLockRedis(),
      flowProducer: { close: vi.fn(), add: vi.fn() } as never,
      now: new Date("2026-05-11T00:00:00Z"),
    });

    // 先 CAS admitted，enqueue 抛错后必须降回 pending 并回滚配额。
    expect(result.readmitted).toBe(0);
    expect(db._updateSet).toHaveBeenNthCalledWith(1, { quotaState: "admitted" });
    expect(db._updateSet).toHaveBeenNthCalledWith(2, { quotaState: "pending_over_quota" });
    expect(mockRollbackAdmit).toHaveBeenCalledWith("k", expect.anything());
  });

  it("uses CAS to skip a stale second worker snapshot without duplicate enqueue", async () => {
    let claimed = false;
    const db = makeDb([
      { itemId: 8, fetchedAt: new Date("2026-05-10T00:00:00Z"), title: "远东电缆", content: null },
    ], (values) => {
      if (values.quotaState !== "admitted") return [{ itemId: 8 }];
      if (claimed) return [];
      claimed = true;
      return [{ itemId: 8 }];
    });
    mockAdmitToScoring.mockResolvedValue({ state: "admitted", counterKey: "k" });
    const deps = {
      db: db as never,
      redis: makeLockRedis(),
      flowProducer: { close: vi.fn(), add: vi.fn() } as never,
      now: new Date("2026-05-11T00:00:00Z"),
    };

    await drainPendingQuotaBacklog(deps);
    await drainPendingQuotaBacklog(deps); // DB read intentionally returns the same stale row

    expect(mockEnqueueItemPipeline).toHaveBeenCalledTimes(1);
    expect(mockRollbackAdmit).toHaveBeenCalledTimes(1);
  });

  it("classifies priority before the 500-row cap", async () => {
    const normalRows = Array.from({ length: 500 }, (_, index) => ({
      itemId: index + 1,
      fetchedAt: new Date(2026, 4, 10, 0, index),
      title: `普通新闻 ${index}`,
      content: null,
    }));
    const priorityRow = {
      itemId: 501,
      fetchedAt: new Date(2026, 4, 10, 12, 0),
      title: "远东电缆安全公告",
      content: null,
    };
    const db = makeDb([...normalRows, priorityRow]);
    mockAdmitToScoring.mockImplementation(({ itemId }) => Promise.resolve(
      itemId === 501
        ? { state: "admitted", counterKey: "priority" }
        : { state: "pending_over_quota", counterKey: "normal" },
    ));

    const result = await drainPendingQuotaBacklog({
      db: db as never,
      redis: makeLockRedis(),
      flowProducer: { close: vi.fn(), add: vi.fn() } as never,
      now: new Date("2026-05-11T00:00:00Z"),
      maxReadmit: 500,
    });

    expect(result.readmitted).toBe(1);
    expect(mockAdmitToScoring).toHaveBeenCalledWith(expect.objectContaining({ itemId: 501, isPriority: true }), expect.anything());
    expect(mockEnqueueItemPipeline).toHaveBeenCalledWith(expect.anything(), 501, expect.any(String));
  });

  // T2（Finding #2）：锁获取失败（SET NX 三次都返回 0）应抛错，不执行 drain。
  it("throws when quota-drain lock cannot be acquired", async () => {
    const db = makeDb([
      { itemId: 7, fetchedAt: new Date("2026-05-10T00:00:00Z"), title: "x", content: null },
    ]);
    mockAdmitToScoring.mockResolvedValue({ state: "admitted", counterKey: "k" });
    const lockedRedis: RedisEvalLike = { eval: vi.fn(async () => 0) }; // 所有 eval 返回 0（拿不到锁）

    await expect(
      drainPendingQuotaBacklog({
        db: db as never,
        redis: lockedRedis,
        flowProducer: { close: vi.fn(), add: vi.fn() } as never,
        now: new Date("2026-05-11T00:00:00Z"),
      })
    ).rejects.toThrow(/quota-drain lock/);
    expect(mockEnqueueItemPipeline).not.toHaveBeenCalled();
  });
});
