import { describe, expect, it } from "vitest";
import { ADMIT_LUA, ROLLBACK_ADMIT_LUA, admitToScoring, admitWebSearch, computePriorityBacklogMetrics, drainBacklog, quotaKey, rollbackAdmit, websearchQuotaKey, type RedisEvalLike } from "../index";
import {
  LOGIN_FAIL_LIMIT,
  LOGIN_FAIL_LUA,
  LOGIN_ADMIT_LUA,
  LOGIN_FAIL_BOTH_LUA,
  LOGIN_ROLLBACK_LUA,
  LOGIN_FAIL_TTL_SECONDS,
  admitLoginAttempt,
  getLoginFailCount,
  loginFailKey,
  recordLoginFailure,
  recordLoginFailureBoth,
  rollbackLoginAdmit
} from "../quota";

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

describe("login fail counter (T-SEC-08 / S2 原子预占)", () => {
  /**
   * 假 Redis：内存 Map + 同步 INCR 语义。
   * LOGIN_ADMIT_LUA = 读 → 超限拒 → 否则 INCR（原子预占）。
   * LOGIN_ROLLBACK_LUA = 安全 DECR。
   * LOGIN_FAIL_BOTH_LUA / LOGIN_FAIL_LUA = 兼容旧路径。
   */
  class LoginFailRedis implements RedisEvalLike {
    readonly store = new Map<string, number>();

    public async eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<number> {
      const keys: string[] = args.slice(0, numberOfKeys).map(String);
      const argv = args.slice(numberOfKeys);
      const key0 = keys[0] ?? "";
      const key1 = keys[1] ?? "";

      if (script === LOGIN_ADMIT_LUA) {
        const limit = Number(argv[0]);
        const u = this.store.get(key0) ?? 0;
        const i = keys.length >= 2 ? (this.store.get(key1) ?? 0) : 0;
        if (u >= limit || i >= limit) return 0;
        this.store.set(key0, u + 1);
        if (keys.length >= 2) this.store.set(key1, i + 1);
        return 1;
      }
      if (script === LOGIN_ROLLBACK_LUA) {
        for (const k of keys) {
          const c = this.store.get(k) ?? 0;
          if (c > 0) this.store.set(k, c - 1);
        }
        return 1;
      }
      if (script === LOGIN_FAIL_BOTH_LUA) {
        for (const k of keys) {
          this.store.set(k, (this.store.get(k) ?? 0) + 1);
        }
        return 1;
      }
      if (script === LOGIN_FAIL_LUA) {
        const next = (this.store.get(key0) ?? 0) + 1;
        this.store.set(key0, next);
        return next;
      }
      if (script.includes("GET")) {
        return this.store.get(key0) ?? 0;
      }
      throw new Error(`unexpected script: ${script}`);
    }

    count(dimension: "username" | "ip", value: string): number {
      return this.store.get(loginFailKey(dimension, value)) ?? 0;
    }
  }

  it("exposes LOGIN_FAIL_LIMIT so callers can compare against the threshold", () => {
    expect(LOGIN_FAIL_LIMIT).toBe(5);
    expect(LOGIN_FAIL_TTL_SECONDS).toBe(15 * 60);
  });

  it("loginFailKey namespaces by dimension under login:fail: (isolated from scoring:counter:)", () => {
    expect(loginFailKey("username", "alice")).toBe("login:fail:username:alice");
    expect(loginFailKey("ip", "1.2.3.4")).toBe("login:fail:ip:1.2.3.4");
    expect(loginFailKey("username", "alice").startsWith("scoring:")).toBe(false);
  });

  it("defect A 回代：20 并发预占恰好 5 次放行、15 次被拒", async () => {
    // 旧 LOGIN_ADMIT_LUA 纯读会 20 全放行；原子预占后必须恰好 LOGIN_FAIL_LIMIT。
    const redis = new LoginFailRedis();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => admitLoginAttempt("attacker", "9.9.9.9", redis))
    );
    const admitted = results.filter(Boolean).length;
    const rejected = results.filter((r) => !r).length;
    expect(admitted).toBe(LOGIN_FAIL_LIMIT);
    expect(rejected).toBe(20 - LOGIN_FAIL_LIMIT);
    expect(redis.count("username", "attacker")).toBe(LOGIN_FAIL_LIMIT);
    expect(redis.count("ip", "9.9.9.9")).toBe(LOGIN_FAIL_LIMIT);
  });

  it("defect A 回代：100 并发错误密码预占通过次数 ≤5", async () => {
    const redis = new LoginFailRedis();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => admitLoginAttempt("spray", "8.8.8.8", redis))
    );
    const admitted = results.filter(Boolean).length;
    expect(admitted).toBeLessThanOrEqual(LOGIN_FAIL_LIMIT);
    expect(admitted).toBe(LOGIN_FAIL_LIMIT);
  });

  it("serial admits: first LIMIT pass, then lock; no double-count on keep-failure path", async () => {
    const redis = new LoginFailRedis();
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLoginAttempt("bob", "10.0.0.1", redis)).resolves.toBe(true);
    }
    await expect(admitLoginAttempt("bob", "10.0.0.1", redis)).resolves.toBe(false);
    expect(redis.count("username", "bob")).toBe(LOGIN_FAIL_LIMIT);
  });

  it("登录成功回滚：3 次失败预占 + 第 4 次成功 DECR → 计数回 3；同 IP 其他 username 不清零", async () => {
    const redis = new LoginFailRedis();
    // 同 IP 上其他用户已有 1 次失败预占（验证 DECR 不清掉其他 username 键；
    // 不能先占满 IP=5，否则 alice 第 4 次预占会被 IP 维度挡住）
    await admitLoginAttempt("other", "10.0.0.5", redis);
    expect(redis.count("username", "other")).toBe(1);
    expect(redis.count("ip", "10.0.0.5")).toBe(1);

    // alice 失败 3 次（保留预占）
    for (let n = 0; n < 3; n += 1) {
      await expect(admitLoginAttempt("alice", "10.0.0.5", redis)).resolves.toBe(true);
    }
    expect(redis.count("username", "alice")).toBe(3);
    expect(redis.count("ip", "10.0.0.5")).toBe(4); // 1 other + 3 alice

    // 第 4 次预占后登录成功 → rollback（DECR，非 DEL）
    await expect(admitLoginAttempt("alice", "10.0.0.5", redis)).resolves.toBe(true);
    expect(redis.count("username", "alice")).toBe(4);
    await rollbackLoginAdmit("alice", "10.0.0.5", redis);

    expect(redis.count("username", "alice")).toBe(3);
    expect(redis.count("ip", "10.0.0.5")).toBe(4); // 1 other + 3 alice（成功那次已 DECR）
    // 同 IP 其他 username 未被清零（若误用 DEL 会清掉 ip 键连带影响，此处 other username 键必须仍在）
    expect(redis.count("username", "other")).toBe(1);
  });

  it("username lock survives IP rotation", async () => {
    const redis = new LoginFailRedis();
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLoginAttempt("carol", `10.0.0.${n}`, redis)).resolves.toBe(true);
    }
    await expect(admitLoginAttempt("carol", "10.0.0.99", redis)).resolves.toBe(false);
  });

  it("IP lock survives username rotation", async () => {
    const redis = new LoginFailRedis();
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLoginAttempt(`user${n}`, "5.6.7.8", redis)).resolves.toBe(true);
    }
    await expect(admitLoginAttempt("brandnew", "5.6.7.8", redis)).resolves.toBe(false);
  });

  it("ip=null 仅 username 维度，不写 login:fail:ip:unknown", async () => {
    const redis = new LoginFailRedis();
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLoginAttempt("solo", null, redis)).resolves.toBe(true);
    }
    await expect(admitLoginAttempt("solo", null, redis)).resolves.toBe(false);
    expect(redis.count("username", "solo")).toBe(LOGIN_FAIL_LIMIT);
    expect([...redis.store.keys()].some((k) => k.includes(":ip:"))).toBe(false);
  });

  it("admitLoginAttempt fail-open on Redis error", async () => {
    const broken: RedisEvalLike = { async eval() { throw new Error("ECONNREFUSED"); } };
    await expect(admitLoginAttempt("alice", "1.2.3.4", broken)).resolves.toBe(true);
  });

  it("rollbackLoginAdmit fail-open on Redis error (no throw)", async () => {
    const broken: RedisEvalLike = { async eval() { throw new Error("ECONNREFUSED"); } };
    await expect(rollbackLoginAdmit("alice", "1.2.3.4", broken)).resolves.toBeUndefined();
  });

  it("recordLoginFailureBoth fail-open on Redis error (no throw)", async () => {
    const broken: RedisEvalLike = { async eval() { throw new Error("ECONNREFUSED"); } };
    await expect(recordLoginFailureBoth("alice", "1.2.3.4", broken)).resolves.toBeUndefined();
  });

  it("legacy recordLoginFailure / getLoginFailCount still work (back-compat)", async () => {
    const redis = new LoginFailRedis();
    expect(await recordLoginFailure("alice|10.0.0.1", redis)).toBe(1);
    expect(await recordLoginFailure("alice|10.0.0.1", redis)).toBe(2);
    expect(await getLoginFailCount("alice|10.0.0.1", redis)).toBe(2);
  });

  it("fail-open: recordLoginFailure swallows Redis errors and returns 0", async () => {
    const broken: RedisEvalLike = {
      async eval() {
        throw new Error("ECONNREFUSED");
      }
    };
    await expect(recordLoginFailure("alice|1.2.3.4", broken)).resolves.toBe(0);
  });

  it("fail-open: getLoginFailCount swallows Redis errors and returns 0", async () => {
    const broken: RedisEvalLike = {
      async eval() {
        throw new Error("ECONNREFUSED");
      }
    };
    await expect(getLoginFailCount("alice|1.2.3.4", broken)).resolves.toBe(0);
  });
});
