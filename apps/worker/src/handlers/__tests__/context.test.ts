import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetDb, mockSelect, mockFrom, mockWhere, mockLogger } = vi.hoisted(() => {
  const mockWhere = vi.fn();
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockGetDb = vi.fn(() => ({ select: mockSelect }));
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
  return { mockGetDb, mockSelect, mockFrom, mockWhere, mockLogger };
});

vi.mock("pino", () => ({
  default: () => mockLogger
}));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  entities: {},
  projectCodes: { code: "code", disabledAt: "disabledAt" },
  scoringConfig: {}
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ({ a, b }),
  isNull: (col: unknown) => ({ col, op: "isNull" })
}));

vi.mock("@fe-radar/core", () => ({
  ownCompanyProfileFromNames: (names: string[]) => ({ names: new Set(names) }),
  DEFAULT_OWN_COMPANY_PROFILE: { names: new Set(["远东控股"]) }
}));

vi.mock("../../lib/entities-dict", () => ({
  EntityDictionary: class {
    constructor(public rows: unknown[]) {}
  }
}));

import {
  __clearProjectCodesCacheForTests,
  loadProjectCodes
} from "../context";

beforeEach(() => {
  vi.clearAllMocks();
  __clearProjectCodesCacheForTests();
  mockWhere.mockReset();
  mockFrom.mockImplementation(() => ({ where: mockWhere }));
  mockSelect.mockImplementation(() => ({ from: mockFrom }));
  mockGetDb.mockImplementation(() => ({ select: mockSelect }));
});

describe("loadProjectCodes (S4 three-state)", () => {
  it("returns codes on successful load and caches them", async () => {
    mockWhere.mockResolvedValueOnce([{ code: "ZX-2026" }, { code: "  " }, { code: "LC-01" }]);
    await expect(loadProjectCodes()).resolves.toEqual(["ZX-2026", "LC-01"]);
    // second call hits cache — no extra DB
    mockWhere.mockClear();
    await expect(loadProjectCodes()).resolves.toEqual(["ZX-2026", "LC-01"]);
    expect(mockWhere).not.toHaveBeenCalled();
  });

  it("成功加载但表为空 → 放行返回 []（合法未配代号，不是未初始化）", async () => {
    mockWhere.mockResolvedValueOnce([]);
    await expect(loadProjectCodes()).resolves.toEqual([]);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("回代：表不存在/查询抛错且无快照 → fail-closed 抛错，阻断公网 LLM", async () => {
    const dbErr = new Error('relation "project_codes" does not exist');
    mockWhere.mockRejectedValueOnce(dbErr);
    await expect(loadProjectCodes()).rejects.toThrow(/project_codes/);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ hasSnapshot: false }),
      expect.stringContaining("blocking public LLM")
    );
    // 不得静默返回 []
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("回代：曾成功加载后 DB 抖动 → 沿用上次快照（可为空）", async () => {
    mockWhere.mockResolvedValueOnce([{ code: "KEEP-ME" }]);
    await expect(loadProjectCodes()).resolves.toEqual(["KEEP-ME"]);

    // expire cache by clearing TTL via internal re-fetch path: force re-query
    // by clearing only expiresAt through a full clear then re-seed snapshot via
    // private cache — use successful load then inject failure after TTL bypass.
    // Simulate expired cache: clear test helper wipes all; re-seed by direct success
    // then fail on next real query by manipulating Date? Simpler: call load once,
    // then make next load see expired cache by re-assigning via second success empty
    // then fail — actually cache is live 5min. Force refresh by clearing cache
    // is not right for "had snapshot". Inject snapshot by first success, then
    // patch expiresAt via second call after manually expiring:
    // We re-export no expire helper; call load with rejected after first success
    // while cache still fresh returns cached without hitting DB.
    // To hit catch-with-snapshot: need cache present but expired.
    // Clear and use a two-step: load success, then mock Date.now far future.
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 10 * 60 * 1000; // past 5min TTL
      mockWhere.mockRejectedValueOnce(new Error("connection refused"));
      await expect(loadProjectCodes()).resolves.toEqual(["KEEP-ME"]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ hasSnapshot: true, snapshotSize: 1 }),
        expect.stringContaining("last successful snapshot")
      );
    } finally {
      Date.now = realNow;
    }
  });

  it("回代：加载成功表空后 DB 抖动 → 仍放行 []（快照存在且为空）", async () => {
    mockWhere.mockResolvedValueOnce([]);
    await expect(loadProjectCodes()).resolves.toEqual([]);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 10 * 60 * 1000;
      mockWhere.mockRejectedValueOnce(new Error("timeout"));
      await expect(loadProjectCodes()).resolves.toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ hasSnapshot: true, snapshotSize: 0 }),
        expect.stringContaining("last successful snapshot")
      );
      expect(mockLogger.error).not.toHaveBeenCalled();
    } finally {
      Date.now = realNow;
    }
  });
});
