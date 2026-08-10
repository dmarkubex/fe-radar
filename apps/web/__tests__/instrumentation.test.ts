import { afterEach, describe, expect, it, vi } from "vitest";
import { register, resolveAuthOriginPolicy } from "../instrumentation";

describe("resolveAuthOriginPolicy", () => {
  it("https origin → useSecureCookie true", () => {
    const p = resolveAuthOriginPolicy("https://radar.example.com");
    expect(p.useSecureCookie).toBe(true);
    expect(p.httpOrigin).toBe(false);
  });

  it("http origin → useSecureCookie false", () => {
    const p = resolveAuthOriginPolicy("http://10.1.20.156:3013");
    expect(p.useSecureCookie).toBe(false);
    expect(p.httpOrigin).toBe(true);
  });
});

describe("instrumentation register (S5 方案 a / S6 去掉 NEXT_PHASE)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AUTH_COOKIE_SECURE;
    delete process.env.NEXT_PHASE;
  });

  it("生产 + 不设 NEXT_PHASE + 空 origin → 抛错（S6 回归：校验必须真正执行）", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // 故意不设 NEXT_PHASE，证明校验不再依赖该死变量
    delete process.env.NEXT_PHASE;
    vi.stubEnv("NEXTAUTH_URL", "");
    delete process.env.AUTH_URL;

    await expect(register()).rejects.toThrow(/不能为空/);
  });

  it("生产 + http origin → 不抛错，且 useSecureCookie 为 false", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "http://10.1.20.156:3013");
    delete process.env.AUTH_URL;
    delete process.env.AUTH_COOKIE_SECURE;
    delete process.env.NEXT_PHASE;

    await expect(register()).resolves.toBeUndefined();

    const policy = resolveAuthOriginPolicy(process.env.NEXTAUTH_URL ?? "");
    expect(policy.useSecureCookie).toBe(false);
    expect(process.env.AUTH_COOKIE_SECURE).toBe("false");
  });

  it("生产 + https origin → 正常，不强制 AUTH_COOKIE_SECURE=false", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "https://radar.example.com");
    delete process.env.AUTH_URL;
    delete process.env.AUTH_COOKIE_SECURE;
    delete process.env.NEXT_PHASE;

    await expect(register()).resolves.toBeUndefined();
    expect(process.env.AUTH_COOKIE_SECURE).toBeUndefined();
    expect(resolveAuthOriginPolicy("https://radar.example.com").useSecureCookie).toBe(true);
  });

  it("生产 + 空 origin → 抛错", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "");
    delete process.env.AUTH_URL;
    delete process.env.NEXT_PHASE;

    await expect(register()).rejects.toThrow(/不能为空/);
  });

  it("生产 + 非法 URL（非绝对 http/https）→ 抛错", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_URL", "not-a-url");
    delete process.env.NEXTAUTH_URL;
    delete process.env.NEXT_PHASE;

    await expect(register()).rejects.toThrow(/绝对 URL/);
  });

  it("生产 + 非 http(s) scheme → 抛错", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_URL", "ftp://files.example.com");
    delete process.env.NEXTAUTH_URL;
    delete process.env.NEXT_PHASE;

    await expect(register()).rejects.toThrow(/绝对 URL/);
  });

  it("development 跳过校验（构建/开发不挂）", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXTAUTH_URL", "");
    delete process.env.AUTH_URL;
    delete process.env.NEXT_PHASE;

    await expect(register()).resolves.toBeUndefined();
  });
});
