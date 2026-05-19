import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("mockReadonlyResponse helper", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns HTTP 503", async () => {
    const { mockReadonlyResponse } = await import("../api/mock-readonly");
    const res = mockReadonlyResponse();
    expect(res.status).toBe(503);
  });

  it("returns MOCK_READONLY error body conforming to { error: { code, message } }", async () => {
    const { mockReadonlyResponse } = await import("../api/mock-readonly");
    const res = mockReadonlyResponse();
    const body = await res.json();
    expect(body).toEqual({ error: { code: "MOCK_READONLY", message: "演示模式不可写" } });
  });

  it("error code is uppercase underscore style", async () => {
    const { mockReadonlyResponse } = await import("../api/mock-readonly");
    const res = mockReadonlyResponse();
    const body = await res.json();
    expect(body.error.code).toMatch(/^[A-Z_]+$/);
  });
});

describe("isMockMode remains false when APP_DATA_MODE is unset (GET paths still work)", () => {
  beforeEach(() => {
    vi.stubEnv("APP_DATA_MODE", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("isMockMode() is false without flag — read paths would reach real DB", async () => {
    const { isMockMode } = await import("../mock-mode");
    expect(isMockMode()).toBe(false);
  });
});

describe("isMockMode is true in mock env — write guard is reachable", () => {
  beforeEach(() => {
    vi.stubEnv("APP_DATA_MODE", "mock");
    vi.stubEnv("NODE_ENV", "test");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("isMockMode() returns true so write branches will hit mockReadonlyResponse", async () => {
    const { isMockMode } = await import("../mock-mode");
    expect(isMockMode()).toBe(true);
  });

  it("mockReadonlyResponse is stable across multiple calls (no mutation)", async () => {
    const { mockReadonlyResponse } = await import("../api/mock-readonly");
    const r1 = mockReadonlyResponse();
    const r2 = mockReadonlyResponse();
    expect(r1.status).toBe(r2.status);
    expect(await r1.json()).toEqual(await r2.json());
  });
});
