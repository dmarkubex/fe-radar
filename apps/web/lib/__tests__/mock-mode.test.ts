import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("mock-mode flag", () => {
  beforeEach(() => {
    vi.stubEnv("APP_DATA_MODE", "");
    vi.stubEnv("NEXT_PUBLIC_APP_DATA_MODE", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns false when no env flag is set", async () => {
    const { isMockMode } = await import("../mock-mode");
    expect(isMockMode()).toBe(false);
  });

  it("returns true when APP_DATA_MODE=mock", async () => {
    vi.stubEnv("APP_DATA_MODE", "mock");
    const { isMockMode } = await import("../mock-mode");
    expect(isMockMode()).toBe(true);
  });

  it("ignores NEXT_PUBLIC_APP_DATA_MODE (must not gate server behavior on client-readable env)", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_DATA_MODE", "mock");
    const { isMockMode } = await import("../mock-mode");
    expect(isMockMode()).toBe(false);
  });

  it("throws at module load when production + mock are combined", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_DATA_MODE", "mock");
    await expect(import("../mock-mode")).rejects.toThrow(/mock 模式|production/);
  });
});
