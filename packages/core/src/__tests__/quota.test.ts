import { describe, expect, it } from "vitest";
import { ADMIT_LUA, ROLLBACK_ADMIT_LUA, admitToScoring, admitWebSearch, computePriorityBacklogMetrics, drainBacklog, quotaKey, rollbackAdmit, websearchQuotaKey, type RedisEvalLike } from "../index";

class FakeRedis implements RedisEvalLike {
  private readonly counts = new Map<string, number>();

  public async eval(script: string, _: number, key: string | number, limit?: string | number): Promise<number> {
    const redisKey = String(key);
    if (script === ROLLBACK_ADMIT_LUA) {
      this.counts.set(redisKey, Math.max(0, (this.counts.get(redisKey) ?? 0) - 1));
      return 1;
    }
    expect(script).toBe(ADMIT_LUA);
    const next = (this.counts.get(redisKey) ?? 0) + 1;
    if (next > Number(limit)) {
      return 0;
    }
    this.counts.set(redisKey, next);
    return next;
  }
}

describe("quota", () => {
  it("admits within independent counters", async () => {
    const redis = new FakeRedis();
    const decision = await admitToScoring({ itemId: 1, isPriority: true, businessDate: "2026-05-11" }, redis);
    expect(decision).toEqual({ state: "admitted", counterKey: quotaKey("priority", "2026-05-11") });
  });

  it("drains stale backlog after seven days", () => {
    const result = drainBacklog([
      { itemId: 1, fetchedAt: new Date("2026-05-01T00:00:00Z") },
      { itemId: 2, fetchedAt: new Date("2026-05-10T00:00:00Z") }
    ], new Date("2026-05-11T00:00:00Z"));
    expect(result.expiredIds).toEqual([1]);
    expect(result.retainedIds).toEqual([2]);
  });

  it("computes priority backlog starvation metrics", () => {
    const metrics = computePriorityBacklogMetrics([
      { priority: true, fetchedAt: new Date("2026-05-09T00:00:00Z") },
      { priority: true, fetchedAt: new Date("2026-05-10T12:00:00Z") }
    ], new Date("2026-05-11T00:00:00Z"));
    expect(metrics.priorityBacklogSize).toBe(2);
    expect(metrics.isRed).toBe(true);
  });

  it("rejects the 201st priority item without incrementing past the limit", async () => {
    const redis = new FakeRedis();
    let state = "admitted";
    for (let itemId = 1; itemId <= 201; itemId += 1) {
      state = (await admitToScoring({ itemId, isPriority: true, businessDate: "2026-05-11" }, redis)).state;
    }
    expect(state).toBe("pending_over_quota");
  });

  it("restores an admitted slot when enqueue compensation rolls the counter back", async () => {
    const redis = new FakeRedis();
    let lastDecision = await admitToScoring({ itemId: 1, isPriority: true, businessDate: "2026-05-11" }, redis);
    for (let itemId = 2; itemId <= 200; itemId += 1) {
      lastDecision = await admitToScoring({ itemId, isPriority: true, businessDate: "2026-05-11" }, redis);
    }

    await rollbackAdmit(lastDecision.counterKey, redis);

    await expect(admitToScoring({ itemId: 201, isPriority: true, businessDate: "2026-05-11" }, redis))
      .resolves.toMatchObject({ state: "admitted" });
  });
});

describe("websearch quota", () => {
  it("admits within monthly budget", async () => {
    const redis = new FakeRedis();
    const decision = await admitWebSearch("2026-06", redis);
    expect(decision).toEqual({ state: "admitted", counterKey: websearchQuotaKey("2026-06") });
  });

  it("rejects the 501st websearch in a month", async () => {
    const redis = new FakeRedis();
    let state = "admitted";
    for (let i = 1; i <= 501; i += 1) {
      state = (await admitWebSearch("2026-06", redis)).state;
    }
    expect(state).toBe("pending_over_quota");
  });

  it("resets counter on month change", async () => {
    const redis = new FakeRedis();
    for (let i = 1; i <= 500; i += 1) {
      await admitWebSearch("2026-06", redis);
    }
    const julyDecision = await admitWebSearch("2026-07", redis);
    expect(julyDecision.state).toBe("admitted");
  });
});
