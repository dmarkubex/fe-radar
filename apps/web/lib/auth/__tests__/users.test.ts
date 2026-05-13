import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("findUserByUsername — mock mode", () => {
  beforeEach(() => {
    vi.stubEnv("APP_DATA_MODE", "mock");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns null for unknown usernames", async () => {
    const { findUserByUsername } = await import("../users");
    await expect(findUserByUsername("ghost")).resolves.toBeNull();
  });

  it("hashes the mock admin password with BCRYPT_WORK_FACTOR (12), not a weaker cost", async () => {
    const { findUserByUsername } = await import("../users");
    const { BCRYPT_WORK_FACTOR } = await import("../password");
    const admin = await findUserByUsername("admin");
    expect(admin).not.toBeNull();
    expect(admin!.passwordHash.startsWith("$2")).toBe(true);
    expect(admin!.passwordHash.split("$")[2]).toBe(String(BCRYPT_WORK_FACTOR));
  });

  it("does not return a synthetic user when mock mode is off", async () => {
    vi.stubEnv("APP_DATA_MODE", "");
    vi.resetModules();
    vi.doMock("@fe-radar/db", () => ({
      getDb: () => ({
        select: () => ({
          from: () => ({
            where: () => ({ limit: async () => [] })
          })
        })
      }),
      users: {}
    }));
    const { findUserByUsername } = await import("../users");
    await expect(findUserByUsername("admin")).resolves.toBeNull();
  });
});
