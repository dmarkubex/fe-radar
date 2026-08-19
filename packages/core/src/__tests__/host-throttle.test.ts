import { beforeEach, describe, expect, it } from "vitest";
import { SourceFetchError } from "@fe-radar/shared";
import {
  HOST_GAP_LUA,
  HOST_THROTTLE_MS,
  asRedisEval,
  setHostThrottleRedis,
  waitHostGapForUrl,
  type RedisEvalLike,
} from "../index";
import { setInternalAllowlistForTests } from "../url-guard";

interface HostGapEvalCall {
  script: string;
  key: string;
  px: number;
}

/** 按 HOST_GAP_LUA 语义（SET NX PX + PTTL）模拟 Redis，记录每次 eval。 */
class FakeHostGapRedis implements RedisEvalLike {
  public readonly calls: HostGapEvalCall[] = [];
  private readonly expiry = new Map<string, number>();

  public async eval(script: string, _nkeys: number, ...args: Array<string | number>): Promise<number> {
    const key = String(args[0]);
    const px = Number(args[1]);
    this.calls.push({ script, key, px });
    const now = Date.now();
    const exp = this.expiry.get(key);
    if (exp === undefined || exp <= now) {
      this.expiry.set(key, now + px);
      return 0;
    }
    return exp - now;
  }
}

/** 永远报告「同站忙，还差 5000ms」，用于验 deadline 切断。 */
class AlwaysBusyRedis implements RedisEvalLike {
  public async eval(): Promise<number> {
    return 5000;
  }
}

describe("waitHostGapForUrl", () => {
  // 必须最先执行：此用例依赖模块内 redis 尚未 setHostThrottleRedis。
  it("throws when setHostThrottleRedis was never called (no noop / fail-open)", async () => {
    await expect(waitHostGapForUrl("http://www.nea.gov.cn/x")).rejects.toThrow(
      "setHostThrottleRedis"
    );
  });

  it("first hit acquires immediately and sends the spec Lua with PX=1000", async () => {
    const redis = new FakeHostGapRedis();
    setHostThrottleRedis(redis);
    const started = Date.now();
    await waitHostGapForUrl("http://www.nea.gov.cn/a");
    expect(Date.now() - started).toBeLessThan(100);
    expect(redis.calls[0]).toEqual({
      script: HOST_GAP_LUA,
      key: "fetch:host-gap:www.nea.gov.cn",
      px: HOST_THROTTLE_MS,
    });
  });

  it("same host: second fetch within 1s sleeps for the remaining gap", async () => {
    const redis = new FakeHostGapRedis();
    setHostThrottleRedis(redis);
    await waitHostGapForUrl("http://www.nea.gov.cn/a");
    const started = Date.now();
    // scheme / path 不同，hostname 相同 → 同一把闸
    await waitHostGapForUrl("https://www.nea.gov.cn/b");
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(900);
    expect(waited).toBeLessThan(2500);
    // 第二次抓取：≥1 次 busy（返回 ttl）+ 睡眠后 ≥1 次 re-acquire；全部命中同一把闸
    expect(redis.calls.length).toBeGreaterThanOrEqual(3);
    expect(new Set(redis.calls.map((c) => c.key)).size).toBe(1);
  });

  it("different hosts proceed in parallel", async () => {
    const redis = new FakeHostGapRedis();
    setHostThrottleRedis(redis);
    const started = Date.now();
    await Promise.all([
      waitHostGapForUrl("http://a.example.com/"),
      waitHostGapForUrl("http://b.example.com/"),
    ]);
    expect(Date.now() - started).toBeLessThan(200);
    expect(redis.calls.map((c) => c.key).sort()).toEqual([
      "fetch:host-gap:a.example.com",
      "fetch:host-gap:b.example.com",
    ]);
  });

  it("hostname lowercased; default port never enters the key", async () => {
    const redis = new FakeHostGapRedis();
    setHostThrottleRedis(redis);
    await waitHostGapForUrl("http://EXAMPLE.mof.gov.cn:80/x");
    expect(redis.calls[0]?.key).toBe("fetch:host-gap:example.mof.gov.cn");
  });

  it("internal allowlisted host bypasses redis entirely", async () => {
    const restore = setInternalAllowlistForTests("rsshub.internal");
    try {
      const redis = new FakeHostGapRedis();
      setHostThrottleRedis(redis);
      const started = Date.now();
      await waitHostGapForUrl("http://rsshub.internal:1200/smm/copper");
      expect(Date.now() - started).toBeLessThan(50);
      expect(redis.calls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("busy host exceeding waitMaxMs throws SourceFetchError FETCH_HOST_THROTTLED", async () => {
    setHostThrottleRedis(new AlwaysBusyRedis());
    const started = Date.now();
    const err = await waitHostGapForUrl("http://busy.example.com/", { waitMaxMs: 500 }).then(
      () => undefined,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(SourceFetchError);
    expect(err).toMatchObject({ code: "FETCH_HOST_THROTTLED" });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("never-resolving eval is cut off at the deadline (no unbounded wait)", async () => {
    const never: RedisEvalLike = { eval: () => new Promise<number>(() => undefined) };
    setHostThrottleRedis(never);
    const started = Date.now();
    await expect(
      waitHostGapForUrl("http://stuck.example.com/", { waitMaxMs: 300 })
    ).rejects.toMatchObject({ code: "FETCH_HOST_THROTTLED" });
    expect(Date.now() - started).toBeLessThan(1200);
  });
});

describe("asRedisEval", () => {
  beforeEach(() => {
    setHostThrottleRedis(new FakeHostGapRedis());
  });

  it("passes through number results", async () => {
    const io = { eval: async (..._args: unknown[]) => 42 };
    await expect(asRedisEval(io).eval("s", 1, "k", 1000)).resolves.toBe(42);
  });

  it("throws when lua returns a non-number", async () => {
    const io = { eval: async (..._args: unknown[]) => "OK" as unknown };
    await expect(asRedisEval(io).eval("s", 1, "k")).rejects.toThrow(
      "host-throttle lua must return number"
    );
  });
});
