import { spawn, type ChildProcess, execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

const execFileAsync = promisify(execFile);

/** Pick an ephemeral free TCP port on loopback. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("failed to bind ephemeral port"));
        return;
      }
      const port = addr.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

/**
 * RedisEvalLike that shells out to redis-cli EVAL against a real redis-server.
 * Executes the exact production Lua string (LOGIN_ADMIT_LUA etc.) — does NOT
 * reimplement admit/or semantics in JS. If production Lua is corrupted
 * (e.g. `or` → `and`), these tests go red.
 */
class RealRedisEval implements RedisEvalLike {
  constructor(private readonly port: number) {}

  public async eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<number> {
    const { stdout } = await execFileAsync(
      "redis-cli",
      ["--raw", "-p", String(this.port), "EVAL", script, String(numberOfKeys), ...args.map(String)],
      { maxBuffer: 4 * 1024 * 1024 }
    );
    const trimmed = stdout.trim();
    // redis-cli --raw prints bare integer / nil; nil → treat as 0 for GET-style scripts.
    if (trimmed === "" || trimmed === "(nil)") return 0;
    const n = Number(trimmed);
    if (Number.isNaN(n)) {
      throw new Error(`unexpected redis-cli EVAL output: ${JSON.stringify(trimmed)}`);
    }
    return n;
  }

  public async flush(): Promise<void> {
    await execFileAsync("redis-cli", ["-p", String(this.port), "FLUSHDB"]);
  }

  public async ttl(key: string): Promise<number> {
    const { stdout } = await execFileAsync("redis-cli", ["--raw", "-p", String(this.port), "TTL", key]);
    return Number(stdout.trim());
  }

  public async get(key: string): Promise<number> {
    const { stdout } = await execFileAsync("redis-cli", ["--raw", "-p", String(this.port), "GET", key]);
    const t = stdout.trim();
    if (t === "" || t === "(nil)") return 0;
    return Number(t);
  }
}

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
   * A-10: 用临时 redis-server + redis-cli EVAL 真正执行导出的 LOGIN_ADMIT_LUA /
   * LOGIN_ROLLBACK_LUA 常量。禁止在 JS 里重写 or/INCR 语义——否则把生产 Lua
   * 的 `or` 改成 `and` 测试仍全绿（codex 已实测）。
   *
   * 覆盖：两键独立阈值（任一达上限即拒）、并发预占、TTL 首次设置。
   */
  let redisProc: ChildProcess | null = null;
  let redisPort = 0;
  let redis: RealRedisEval;

  async function count(dimension: "username" | "ip", value: string): Promise<number> {
    return redis.get(loginFailKey(dimension, value));
  }

  beforeAll(async () => {
    redisPort = await freePort();
    redisProc = spawn(
      "redis-server",
      [
        "--port", String(redisPort),
        "--bind", "127.0.0.1",
        "--save", "",
        "--appendonly", "no",
        "--dir", "/tmp",
        "--dbfilename", `t7-quota-${redisPort}.rdb`,
      ],
      { stdio: "ignore" }
    );
    // Wait until PONG
    const deadline = Date.now() + 5000;
    for (;;) {
      try {
        const { stdout } = await execFileAsync("redis-cli", ["-p", String(redisPort), "ping"]);
        if (stdout.trim() === "PONG") break;
      } catch {
        // not ready
      }
      if (Date.now() > deadline) {
        throw new Error(`redis-server on :${redisPort} did not become ready`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    redis = new RealRedisEval(redisPort);
  }, 15_000);

  afterAll(async () => {
    try {
      await execFileAsync("redis-cli", ["-p", String(redisPort), "shutdown", "nosave"]);
    } catch {
      // already dead
    }
    if (redisProc && !redisProc.killed) {
      redisProc.kill("SIGTERM");
    }
  });

  beforeEach(async () => {
    await redis.flush();
  });

  it("exposes LOGIN_FAIL_LIMIT so callers can compare against the threshold", () => {
    expect(LOGIN_FAIL_LIMIT).toBe(5);
    expect(LOGIN_FAIL_TTL_SECONDS).toBe(15 * 60);
  });

  it("loginFailKey namespaces by dimension under login:fail: (isolated from scoring:counter:)", () => {
    expect(loginFailKey("username", "alice")).toBe("login:fail:username:alice");
    expect(loginFailKey("ip", "1.2.3.4")).toBe("login:fail:ip:1.2.3.4");
    expect(loginFailKey("username", "alice").startsWith("scoring:")).toBe(false);
  });

  it("exports LOGIN_ADMIT_LUA with independent-counter OR gate (script constant smoke)", () => {
    // Guard the production source string itself so a silent rewrite is caught even
    // before a full redis suite runs. The real-eval tests below are the authority.
    expect(LOGIN_ADMIT_LUA).toMatch(/u\s*>=\s*limit\s+or\s+i\s*>=\s*limit/);
    expect(LOGIN_ADMIT_LUA).not.toMatch(/u\s*>=\s*limit\s+and\s+i\s*>=\s*limit/);
    expect(LOGIN_ROLLBACK_LUA).toContain("safeDecr");
  });

  it("defect A 回代：20 并发预占恰好 5 次放行、15 次被拒（真 Lua）", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => admitLoginAttempt("attacker", "9.9.9.9", redis))
    );
    const admitted = results.filter(Boolean).length;
    const rejected = results.filter((r) => !r).length;
    expect(admitted).toBe(LOGIN_FAIL_LIMIT);
    expect(rejected).toBe(20 - LOGIN_FAIL_LIMIT);
    expect(await count("username", "attacker")).toBe(LOGIN_FAIL_LIMIT);
    expect(await count("ip", "9.9.9.9")).toBe(LOGIN_FAIL_LIMIT);
  });

  it("defect A 回代：100 并发错误密码预占通过次数 ≤5（真 Lua）", async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, () => admitLoginAttempt("spray", "8.8.8.8", redis))
    );
    const admitted = results.filter(Boolean).length;
    expect(admitted).toBeLessThanOrEqual(LOGIN_FAIL_LIMIT);
    expect(admitted).toBe(LOGIN_FAIL_LIMIT);
  });

  it("serial admits: first LIMIT pass, then lock (true LOGIN_ADMIT_LUA)", async () => {
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLoginAttempt("bob", "10.0.0.1", redis)).resolves.toBe(true);
    }
    await expect(admitLoginAttempt("bob", "10.0.0.1", redis)).resolves.toBe(false);
    expect(await count("username", "bob")).toBe(LOGIN_FAIL_LIMIT);
  });

  it("TTL is set only on first INCR of each key", async () => {
    await expect(admitLoginAttempt("ttluser", "10.0.0.7", redis)).resolves.toBe(true);
    const uTtl = await redis.ttl(loginFailKey("username", "ttluser"));
    const iTtl = await redis.ttl(loginFailKey("ip", "10.0.0.7"));
    // redis TTL: -2 missing, -1 no expire, >0 seconds remaining
    expect(uTtl).toBeGreaterThan(0);
    expect(uTtl).toBeLessThanOrEqual(LOGIN_FAIL_TTL_SECONDS);
    expect(iTtl).toBeGreaterThan(0);
    expect(iTtl).toBeLessThanOrEqual(LOGIN_FAIL_TTL_SECONDS);

    // Second admit must not wipe TTL back to full window if EXPIRE only on ==1
    // (allow small clock skew; just require TTL still positive and not grown past limit)
    await expect(admitLoginAttempt("ttluser", "10.0.0.7", redis)).resolves.toBe(true);
    const uTtl2 = await redis.ttl(loginFailKey("username", "ttluser"));
    expect(uTtl2).toBeGreaterThan(0);
    expect(uTtl2).toBeLessThanOrEqual(LOGIN_FAIL_TTL_SECONDS);
  });

  it("登录成功回滚：3 次失败预占 + 第 4 次成功 DECR → 计数回 3；同 IP 其他 username 不清零", async () => {
    await admitLoginAttempt("other", "10.0.0.5", redis);
    expect(await count("username", "other")).toBe(1);
    expect(await count("ip", "10.0.0.5")).toBe(1);

    for (let n = 0; n < 3; n += 1) {
      await expect(admitLoginAttempt("alice", "10.0.0.5", redis)).resolves.toBe(true);
    }
    expect(await count("username", "alice")).toBe(3);
    expect(await count("ip", "10.0.0.5")).toBe(4);

    await expect(admitLoginAttempt("alice", "10.0.0.5", redis)).resolves.toBe(true);
    expect(await count("username", "alice")).toBe(4);
    await rollbackLoginAdmit("alice", "10.0.0.5", redis);

    expect(await count("username", "alice")).toBe(3);
    expect(await count("ip", "10.0.0.5")).toBe(4);
    expect(await count("username", "other")).toBe(1);
  });

  it("username lock survives IP rotation (independent counters, true Lua)", async () => {
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLoginAttempt("carol", `10.0.0.${n}`, redis)).resolves.toBe(true);
    }
    await expect(admitLoginAttempt("carol", "10.0.0.99", redis)).resolves.toBe(false);
  });

  it("IP lock survives username rotation — single counter at limit rejects (or-gate)", async () => {
    // This is the A-10 smoking gun: if Lua uses `and` instead of `or`, a fresh
    // username with a locked IP would still be admitted.
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLoginAttempt(`user${n}`, "5.6.7.8", redis)).resolves.toBe(true);
    }
    await expect(admitLoginAttempt("brandnew", "5.6.7.8", redis)).resolves.toBe(false);
    // brandnew username counter is still 0 — rejection came solely from IP
    expect(await count("username", "brandnew")).toBe(0);
    expect(await count("ip", "5.6.7.8")).toBe(LOGIN_FAIL_LIMIT);
  });

  it("ip=null 仅 username 维度，不写 login:fail:ip:*", async () => {
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLoginAttempt("solo", null, redis)).resolves.toBe(true);
    }
    await expect(admitLoginAttempt("solo", null, redis)).resolves.toBe(false);
    expect(await count("username", "solo")).toBe(LOGIN_FAIL_LIMIT);
    // No IP key should exist under this username-only path
    const { stdout } = await execFileAsync("redis-cli", [
      "--raw", "-p", String(redisPort), "KEYS", "login:fail:ip:*",
    ]);
    expect(stdout.trim()).toBe("");
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

  it("legacy recordLoginFailure / getLoginFailCount still work via true Lua", async () => {
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

  // Silence unused-import lint for constants still referenced as identity in RealRedis path.
  it("LOGIN_FAIL_BOTH_LUA / LOGIN_FAIL_LUA constants are executable", async () => {
    const admitted = await redis.eval(LOGIN_FAIL_BOTH_LUA, 2, "login:fail:username:x", "login:fail:ip:1.1.1.1", LOGIN_FAIL_TTL_SECONDS);
    expect(admitted).toBe(1);
    expect(await redis.get("login:fail:username:x")).toBe(1);
    const single = await redis.eval(LOGIN_FAIL_LUA, 1, "login:fail:legacy", 0, LOGIN_FAIL_TTL_SECONDS);
    expect(single).toBe(1);
  });
});
