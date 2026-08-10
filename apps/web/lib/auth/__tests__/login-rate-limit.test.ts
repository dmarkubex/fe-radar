import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock ioredis so getClient returns a controllable fake capturing eval calls.
const fakeRedis = vi.hoisted(() => {
  // S2: LOGIN_ADMIT_LUA 原子预占（读→超限拒→INCR）；LOGIN_ROLLBACK_LUA 安全 DECR。
  const counts = new Map<string, number>();
  const evalFn = vi.fn(async (script: string, numberOfKeys: number, ...args: Array<string | number>) => {
    const keys: string[] = args.slice(0, numberOfKeys).map(String);
    const argv = args.slice(numberOfKeys);
    const key0 = keys[0] ?? "";
    const key1 = keys[1] ?? "";

    // admit: contains INCR after GET check (pre-reserve)
    if (script.includes("INCR") && script.includes("limit") && !script.includes("safeDecr") && script.includes("GET")) {
      const limit = Number(argv[0]);
      const u = counts.get(key0) ?? 0;
      const i = keys.length >= 2 ? (counts.get(key1) ?? 0) : 0;
      if (u >= limit || i >= limit) return 0;
      counts.set(key0, u + 1);
      if (keys.length >= 2) counts.set(key1, i + 1);
      return 1;
    }
    // rollback: DECR path
    if (script.includes("DECR") || script.includes("safeDecr")) {
      for (const k of keys) {
        const c = counts.get(k) ?? 0;
        if (c > 0) counts.set(k, c - 1);
      }
      return 1;
    }
    // legacy dual fail INCR (if ever called)
    if (script.includes("INCR") && script.includes("EXPIRE") && !script.includes("limit")) {
      for (const k of keys) {
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      return 1;
    }
    return 0;
  });
  return { eval: evalFn, on: vi.fn(), _counts: counts };
});
vi.mock("ioredis", () => ({
  default: vi.fn(function MockRedis() {
    return fakeRedis;
  })
}));
vi.mock("@/lib/logger", () => ({ webLogger: { warn: vi.fn() } }));

import {
  admitLogin,
  isTrustProxyHeaders,
  recordFailedLogin,
  resolveLoginClientIp,
  rollbackLoginAdmit,
  trustedClientIp
} from "@/lib/auth/login-rate-limit";
import { LOGIN_FAIL_LIMIT } from "@fe-radar/core";

describe("login-rate-limit helpers (T-SEC-08 / S2)", () => {
  beforeEach(() => {
    fakeRedis.eval.mockClear();
    fakeRedis._counts.clear();
    vi.stubEnv("DISABLE_LOGIN_RATE_LIMIT", "");
    vi.stubEnv("TRUST_PROXY_HEADERS", "");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe("XFF / TRUST_PROXY_HEADERS 可信边界", () => {
    it("默认关闭：isTrustProxyHeaders 为 false", () => {
      expect(isTrustProxyHeaders()).toBe(false);
    });

    it("TRUST_PROXY_HEADERS 未设时，伪造 X-Forwarded-For 不影响限速键（忽略 XFF）", () => {
      // 无 peer → null，绝不产生 "unknown"
      expect(resolveLoginClientIp("203.0.113.99, 10.0.0.1", null)).toBe(null);
      expect(resolveLoginClientIp("1.2.3.4", undefined)).toBe(null);
      // 有 peer 时用 peer，忽略伪造 XFF
      expect(resolveLoginClientIp("203.0.113.99", "192.168.1.10")).toBe("192.168.1.10");
      expect(resolveLoginClientIp("evil.forged.ip", "192.168.1.10")).toBe("192.168.1.10");
    });

    it("取不到 peer 时不产生共享 unknown 键（返回 null，跳过 IP 维度）", () => {
      expect(resolveLoginClientIp(null, null)).toBe(null);
      expect(resolveLoginClientIp(undefined, undefined)).toBe(null);
      expect(resolveLoginClientIp(null, "unknown")).toBe(null);
      expect(resolveLoginClientIp(null, "  ")).toBe(null);
      // trustedClientIp 自身也不返回 unknown
      expect(trustedClientIp(null)).toBe(null);
      expect(trustedClientIp("")).toBe(null);
    });

    it("TRUST_PROXY_HEADERS=true 时从右侧数可信跳解析 XFF", () => {
      vi.stubEnv("TRUST_PROXY_HEADERS", "true");
      expect(resolveLoginClientIp("203.0.113.5, 10.0.0.1", null)).toBe("10.0.0.1");
      expect(resolveLoginClientIp("203.0.113.5", null)).toBe("203.0.113.5");
      // XFF 缺失时回退 peer，仍不写 unknown
      expect(resolveLoginClientIp(null, "192.168.0.2")).toBe("192.168.0.2");
      expect(resolveLoginClientIp(null, null)).toBe(null);
    });

    it("TRUSTED_PROXY_HOPS=2 时取右数第二项", () => {
      vi.stubEnv("TRUST_PROXY_HEADERS", "true");
      vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
      expect(resolveLoginClientIp("203.0.113.5, 10.0.0.1, 10.0.0.2", null)).toBe("10.0.0.1");
      expect(resolveLoginClientIp("203.0.113.5", null)).toBe("203.0.113.5");
    });
  });

  it("原子预占：前 LIMIT 次 admit 放行并计数，第 LIMIT+1 次拒绝", async () => {
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLogin("bob", "10.0.0.1")).resolves.toBe(true);
    }
    await expect(admitLogin("bob", "10.0.0.1")).resolves.toBe(false);
  });

  it("登录成功回滚后计数回落，同 IP 其他 username 保留", async () => {
    // other 先占 1 次（不能占满 IP，否则 alice 第 4 次预占会被 IP 维度挡住）
    await admitLogin("other", "10.0.0.5");
    await admitLogin("alice", "10.0.0.5");
    await admitLogin("alice", "10.0.0.5");
    await admitLogin("alice", "10.0.0.5");
    // 第 4 次预占后成功 → rollback（DECR 非 DEL）
    await expect(admitLogin("alice", "10.0.0.5")).resolves.toBe(true);
    await rollbackLoginAdmit("alice", "10.0.0.5");

    expect(fakeRedis._counts.get("login:fail:username:alice")).toBe(3);
    expect(fakeRedis._counts.get("login:fail:username:other")).toBe(1);
    // ip = 1 other + 3 alice (success rolled back one)
    expect(fakeRedis._counts.get("login:fail:ip:10.0.0.5")).toBe(4);
  });

  it("username lock survives IP rotation", async () => {
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLogin("carol", `10.0.0.${n}`)).resolves.toBe(true);
    }
    await expect(admitLogin("carol", "10.0.0.99")).resolves.toBe(false);
  });

  it("IP lock survives username rotation", async () => {
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLogin(`user${n}`, "5.6.7.8")).resolves.toBe(true);
    }
    await expect(admitLogin("brandnew", "5.6.7.8")).resolves.toBe(false);
  });

  it("ip=null 仅 username 维度", async () => {
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLogin("solo", null)).resolves.toBe(true);
    }
    await expect(admitLogin("solo", null)).resolves.toBe(false);
    expect([...fakeRedis._counts.keys()].some((k) => k.includes(":ip:"))).toBe(false);
  });

  it("fail-open when DISABLE_LOGIN_RATE_LIMIT=true", async () => {
    vi.stubEnv("DISABLE_LOGIN_RATE_LIMIT", "true");
    await expect(admitLogin("alice", "1.2.3.4")).resolves.toBe(true);
    expect(fakeRedis.eval).not.toHaveBeenCalled();
  });

  it("recordFailedLogin 为 no-op（预占模型失败不二次 INCR）", async () => {
    await admitLogin("alice", "1.2.3.4");
    const before = fakeRedis._counts.get("login:fail:username:alice");
    await recordFailedLogin("alice", "1.2.3.4");
    expect(fakeRedis._counts.get("login:fail:username:alice")).toBe(before);
  });

  it("Redis eval 抛错时 admit fail-open 放行", async () => {
    fakeRedis.eval.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(admitLogin("alice", "1.2.3.4")).resolves.toBe(true);
  });
});
