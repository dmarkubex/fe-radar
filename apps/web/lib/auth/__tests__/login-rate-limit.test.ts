import { spawn, type ChildProcess, execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

/**
 * A-10: mock ioredis 只截获连接；eval 通过 redis-cli 把**生产导出的 Lua 脚本原文**
 * 交给临时 redis-server 执行。禁止在 JS 里重写 `or`/INCR 语义（旧实现把生产
 * Lua `or→and` 改坏后测试仍全绿）。
 */
const fakeRedis = vi.hoisted(() => {
  const state = { port: 0, ctorCount: 0 };
  const evalFn = vi.fn(async (script: string, numberOfKeys: number, ...args: Array<string | number>) => {
    if (!state.port) throw new Error("test redis not ready");
    const { stdout } = await execFileAsync(
      "redis-cli",
      ["--raw", "-p", String(state.port), "EVAL", script, String(numberOfKeys), ...args.map(String)],
      { maxBuffer: 4 * 1024 * 1024 }
    );
    const trimmed = stdout.trim();
    if (trimmed === "" || trimmed === "(nil)") return 0;
    const n = Number(trimmed);
    if (Number.isNaN(n)) throw new Error(`unexpected EVAL output: ${JSON.stringify(trimmed)}`);
    return n;
  });
  return { eval: evalFn, on: vi.fn(), _state: state };
});
vi.mock("ioredis", () => ({
  default: vi.fn(function MockRedis() {
    fakeRedis._state.ctorCount += 1;
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
import { LOGIN_FAIL_LIMIT, loginFailKey } from "@fe-radar/core";

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

async function redisGet(key: string): Promise<number> {
  const { stdout } = await execFileAsync("redis-cli", [
    "--raw", "-p", String(fakeRedis._state.port), "GET", key,
  ]);
  const t = stdout.trim();
  if (t === "" || t === "(nil)") return 0;
  return Number(t);
}

describe("login-rate-limit helpers (T-SEC-08 / S2)", () => {
  let redisProc: ChildProcess | null = null;

  beforeAll(async () => {
    const port = await freePort();
    fakeRedis._state.port = port;
    redisProc = spawn(
      "redis-server",
      [
        "--port", String(port),
        "--bind", "127.0.0.1",
        "--save", "",
        "--appendonly", "no",
        "--dir", "/tmp",
        "--dbfilename", `t7-login-${port}.rdb`,
      ],
      { stdio: "ignore" }
    );
    const deadline = Date.now() + 5000;
    for (;;) {
      try {
        const { stdout } = await execFileAsync("redis-cli", ["-p", String(port), "ping"]);
        if (stdout.trim() === "PONG") break;
      } catch {
        // not ready
      }
      if (Date.now() > deadline) throw new Error(`redis-server on :${port} not ready`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }, 15_000);

  afterAll(async () => {
    try {
      await execFileAsync("redis-cli", ["-p", String(fakeRedis._state.port), "shutdown", "nosave"]);
    } catch {
      // ignore
    }
    if (redisProc && !redisProc.killed) redisProc.kill("SIGTERM");
  });

  beforeEach(async () => {
    fakeRedis.eval.mockClear();
    // restore real-Lua implementation if a prior test used mockRejectedValue*
    fakeRedis.eval.mockImplementation(async (script: string, numberOfKeys: number, ...args: Array<string | number>) => {
      const { stdout } = await execFileAsync(
        "redis-cli",
        ["--raw", "-p", String(fakeRedis._state.port), "EVAL", script, String(numberOfKeys), ...args.map(String)],
        { maxBuffer: 4 * 1024 * 1024 }
      );
      const trimmed = stdout.trim();
      if (trimmed === "" || trimmed === "(nil)") return 0;
      const n = Number(trimmed);
      if (Number.isNaN(n)) throw new Error(`unexpected EVAL output: ${JSON.stringify(trimmed)}`);
      return n;
    });
    await execFileAsync("redis-cli", ["-p", String(fakeRedis._state.port), "FLUSHDB"]);
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

    // A-4：Auth.js authorize 路径固定 peer=null（Web Request 无 .ip；Next 15 亦无 NextRequest.ip）
    it("A-4: authorize 路径 peer=null 时默认跳过 IP；仅 TRUST_PROXY+XFF 启用 IP 维度", () => {
      // 默认关闭 trust：有伪造 XFF 也忽略 → null
      expect(resolveLoginClientIp("203.0.113.9", null)).toBe(null);
      // 开启 trust 后才用 XFF
      vi.stubEnv("TRUST_PROXY_HEADERS", "true");
      expect(resolveLoginClientIp("203.0.113.9", null)).toBe("203.0.113.9");
      expect(resolveLoginClientIp(null, null)).toBe(null);
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

  it("原子预占：前 LIMIT 次 admit 放行并计数，第 LIMIT+1 次拒绝（真 Lua）", async () => {
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLogin("bob", "10.0.0.1")).resolves.toBe(true);
    }
    await expect(admitLogin("bob", "10.0.0.1")).resolves.toBe(false);
    // wrapper 传参：至少一次 EVAL，且脚本为生产 LOGIN_ADMIT_LUA（含 or 门）
    expect(fakeRedis.eval).toHaveBeenCalled();
    const firstScript = String(fakeRedis.eval.mock.calls[0]?.[0] ?? "");
    expect(firstScript).toMatch(/u\s*>=\s*limit\s+or\s+i\s*>=\s*limit/);
  });

  it("登录成功回滚后计数回落，同 IP 其他 username 保留（真 Lua）", async () => {
    // other 先占 1 次（不能占满 IP，否则 alice 第 4 次预占会被 IP 维度挡住）
    await admitLogin("other", "10.0.0.5");
    await admitLogin("alice", "10.0.0.5");
    await admitLogin("alice", "10.0.0.5");
    await admitLogin("alice", "10.0.0.5");
    // 第 4 次预占后成功 → rollback（DECR 非 DEL）
    await expect(admitLogin("alice", "10.0.0.5")).resolves.toBe(true);
    await rollbackLoginAdmit("alice", "10.0.0.5");

    expect(await redisGet(loginFailKey("username", "alice"))).toBe(3);
    expect(await redisGet(loginFailKey("username", "other"))).toBe(1);
    // ip = 1 other + 3 alice (success rolled back one)
    expect(await redisGet(loginFailKey("ip", "10.0.0.5"))).toBe(4);
  });

  it("username lock survives IP rotation", async () => {
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLogin("carol", `10.0.0.${n}`)).resolves.toBe(true);
    }
    await expect(admitLogin("carol", "10.0.0.99")).resolves.toBe(false);
  });

  it("IP lock survives username rotation (or-gate; 真 Lua 拒绝单键超限)", async () => {
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLogin(`user${n}`, "5.6.7.8")).resolves.toBe(true);
    }
    await expect(admitLogin("brandnew", "5.6.7.8")).resolves.toBe(false);
    // brandnew 未被 INCR —— 拒绝只因 IP 达限（若 Lua 用 and 会放行并写成 1）
    expect(await redisGet(loginFailKey("username", "brandnew"))).toBe(0);
    expect(await redisGet(loginFailKey("ip", "5.6.7.8"))).toBe(LOGIN_FAIL_LIMIT);
  });

  it("ip=null 仅 username 维度", async () => {
    for (let n = 0; n < LOGIN_FAIL_LIMIT; n += 1) {
      await expect(admitLogin("solo", null)).resolves.toBe(true);
    }
    await expect(admitLogin("solo", null)).resolves.toBe(false);
    const { stdout } = await execFileAsync("redis-cli", [
      "--raw", "-p", String(fakeRedis._state.port), "KEYS", "login:fail:ip:*",
    ]);
    expect(stdout.trim()).toBe("");
  });

  it("fail-open when DISABLE_LOGIN_RATE_LIMIT=true", async () => {
    vi.stubEnv("DISABLE_LOGIN_RATE_LIMIT", "true");
    await expect(admitLogin("alice", "1.2.3.4")).resolves.toBe(true);
    expect(fakeRedis.eval).not.toHaveBeenCalled();
  });

  it("recordFailedLogin 为 no-op（预占模型失败不二次 INCR）", async () => {
    await admitLogin("alice", "1.2.3.4");
    const before = await redisGet(loginFailKey("username", "alice"));
    await recordFailedLogin("alice", "1.2.3.4");
    expect(await redisGet(loginFailKey("username", "alice"))).toBe(before);
  });

  it("Redis eval 抛错时 admit fail-open 放行", async () => {
    fakeRedis.eval.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(admitLogin("alice", "1.2.3.4")).resolves.toBe(true);
  });

  describe("client 连接关闭后自动重建 (T12 / B-4)", () => {
    // resetModules 后需重新求值得到一个 client=null 的新模块实例做隔离测试；
    // 静态 import 是首次求值的单例绑定，无法重置其模块级 client，故走动态 import（模块加载边界）。
    let mod: { admitLogin: typeof admitLogin };

    beforeEach(async () => {
      vi.resetModules();
      mod = await import("@/lib/auth/login-rate-limit");
      fakeRedis._state.ctorCount = 0;
    });

    it("end 事件后下一次调用应新建连接（不复用死实例）", async () => {
      // 第一次调用：建一个 client
      await mod.admitLogin("x", "1.2.3.4");
      expect(fakeRedis._state.ctorCount).toBe(1);
      // 捕获 getClient 注册的 end handler 并触发（模拟连接进入 end 状态）
      const endCalls = fakeRedis.on.mock.calls.filter((c) => c[0] === "end");
      expect(endCalls).toHaveLength(1);
      const endHandler = endCalls[0]![1] as () => void;
      endHandler();
      // 修复前：死 client 被无限复用，ctorCount 仍为 1；修复后：重建连接，ctorCount=2
      fakeRedis.eval.mockClear();
      await mod.admitLogin("x", "1.2.3.4");
      expect(fakeRedis._state.ctorCount).toBe(2);
      expect(fakeRedis.eval).toHaveBeenCalled();
    });

    it("正常连接不重复建 client（连接复用，仅 end 后才重建）", async () => {
      await mod.admitLogin("a", "1.2.3.4");
      expect(fakeRedis._state.ctorCount).toBe(1);
      await mod.admitLogin("b", "1.2.3.4");
      await mod.admitLogin("c", "1.2.3.4");
      // 仍只建过一次：没有 end 事件就不重建，保留连接复用
      expect(fakeRedis._state.ctorCount).toBe(1);
    });

    it("DISABLE_LOGIN_RATE_LIMIT=true 时不建连接（行为不变）", async () => {
      vi.stubEnv("DISABLE_LOGIN_RATE_LIMIT", "true");
      await expect(mod.admitLogin("z", "1.2.3.4")).resolves.toBe(true);
      expect(fakeRedis._state.ctorCount).toBe(0);
      expect(fakeRedis.eval).not.toHaveBeenCalled();
    });
  });
});
