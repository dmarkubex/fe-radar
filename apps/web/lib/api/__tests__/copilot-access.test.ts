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

import { evaluateCopilotAccess } from "../copilot-access";

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
});
