import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetDb, selectLimit, usersLimit } = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const usersLimit = vi.fn();
  return { mockGetDb: vi.fn(), selectLimit, usersLimit };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val, op: "eq" })
}));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  copilotFeatureFlags: {
    key: "key",
    enabled: "enabled",
    userIds: "userIds",
    depts: "depts"
  },
  users: {
    id: "users.id",
    dept: "users.dept"
  }
}));

import { clearCopilotAccessCache, evaluateCopilotAccess } from "../copilot-access";

function mockFlagThenUser(
  flagRows: Array<{ enabled: boolean; userIds: number[]; depts: string[] }>,
  userRows: Array<{ dept: string | null }>
): void {
  selectLimit.mockReset();
  usersLimit.mockReset();
  selectLimit.mockResolvedValue(flagRows);
  usersLimit.mockResolvedValue(userRows);
  mockGetDb.mockReturnValue({
    select: () => ({
      from: (table: { key?: string; id?: string }) => ({
        where: () => ({
          limit: table.key === "key" ? selectLimit : usersLimit
        })
      })
    })
  });
}

describe("evaluateCopilotAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCopilotAccessCache();
  });

  it("returns false when the flag row is missing", async () => {
    mockFlagThenUser([], [{ dept: "采购" }]);
    expect(await evaluateCopilotAccess(1)).toBe(false);
  });

  it("returns false when enabled is false", async () => {
    mockFlagThenUser([{ enabled: false, userIds: [1], depts: ["采购"] }], [{ dept: "采购" }]);
    expect(await evaluateCopilotAccess(1)).toBe(false);
  });

  it("returns false when both allow-lists are empty", async () => {
    mockFlagThenUser([{ enabled: true, userIds: [], depts: [] }], [{ dept: "采购" }]);
    expect(await evaluateCopilotAccess(1)).toBe(false);
  });

  it("returns true when userId is in user_ids", async () => {
    mockFlagThenUser([{ enabled: true, userIds: [7], depts: [] }], [{ dept: null }]);
    expect(await evaluateCopilotAccess(7)).toBe(true);
  });

  it("returns true when dept is in depts", async () => {
    mockFlagThenUser([{ enabled: true, userIds: [], depts: ["采购"] }], [{ dept: "采购" }]);
    expect(await evaluateCopilotAccess(9)).toBe(true);
  });

  it("returns false when dept is null even if depts is non-empty", async () => {
    mockFlagThenUser([{ enabled: true, userIds: [], depts: ["采购"] }], [{ dept: null }]);
    expect(await evaluateCopilotAccess(9)).toBe(false);
  });

  it("propagates database errors for callers to fail-closed", async () => {
    selectLimit.mockRejectedValueOnce(new Error("flags down"));
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: selectLimit })
        })
      })
    });
    await expect(evaluateCopilotAccess(1)).rejects.toThrow("flags down");
  });

  it("reuses a true result on a second call without hitting the db", async () => {
    mockFlagThenUser([{ enabled: true, userIds: [7], depts: [] }], [{ dept: null }]);
    expect(await evaluateCopilotAccess(7)).toBe(true);
    mockGetDb.mockClear();
    selectLimit.mockClear();
    usersLimit.mockClear();
    expect(await evaluateCopilotAccess(7)).toBe(true);
    expect(selectLimit).not.toHaveBeenCalled();
    expect(usersLimit).not.toHaveBeenCalled();
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("does not read or write the default cache when options.db is injected", async () => {
    const injectedLimit = vi.fn().mockResolvedValue([]);
    const injectedDb = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: injectedLimit })
        })
      })
    };
    expect(await evaluateCopilotAccess(1, { db: injectedDb as never })).toBe(false);
    expect(injectedLimit).toHaveBeenCalledTimes(1);

    mockFlagThenUser([{ enabled: true, userIds: [1], depts: [] }], [{ dept: null }]);
    expect(await evaluateCopilotAccess(1)).toBe(true);
    expect(selectLimit).toHaveBeenCalledTimes(1);
    expect(usersLimit).toHaveBeenCalledTimes(1);
  });

  it("does not cache rejected database errors", async () => {
    selectLimit.mockRejectedValueOnce(new Error("flags down"));
    mockGetDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: selectLimit })
        })
      })
    });
    await expect(evaluateCopilotAccess(1)).rejects.toThrow("flags down");

    mockFlagThenUser([{ enabled: true, userIds: [1], depts: [] }], [{ dept: null }]);
    expect(await evaluateCopilotAccess(1)).toBe(true);
    expect(selectLimit).toHaveBeenCalledTimes(1);
  });
});
