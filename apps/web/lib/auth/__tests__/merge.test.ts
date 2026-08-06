import { describe, expect, it } from "vitest";
import { decideMergeAction, mergeOrCreateUser, UserDisabledError } from "../merge";

import type { DbClient } from "@fe-radar/db";

describe("merge decision tree", () => {
  it("returns existing when unionid already exists", () => {
    expect(decideMergeAction(true, 0)).toBe("existing");
  });

  it("auto merges exactly one name and dept candidate", () => {
    expect(decideMergeAction(false, 1)).toBe("auto_merge");
  });

  it("writes conflict and creates fallback user for duplicate candidates", () => {
    expect(decideMergeAction(false, 2)).toBe("conflict_new_user");
  });

  it("creates dingtalk-only user when there is no local candidate", () => {
    expect(decideMergeAction(false, 0)).toBe("new_user");
  });
});

describe("mergeOrCreateUser disabled gate (FR-05a)", () => {
  it("throws UserDisabledError when dingtalkId match has disabledAt set", async () => {
    const existing = {
      id: 7,
      name: "停用用户",
      role: "viewer",
      dingtalkId: "union-disabled",
      disabledAt: new Date("2026-01-01T00:00:00.000Z")
    };

    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [existing]
          })
        })
      })
    };

    const db = {
      transaction: async <T>(fn: (inner: typeof tx) => Promise<T>): Promise<T> => fn(tx)
    } as unknown as DbClient;

    await expect(
      mergeOrCreateUser({ unionid: "union-disabled", name: "停用用户", dept: null }, db)
    ).rejects.toBeInstanceOf(UserDisabledError);
  });

  it("returns existing user when dingtalkId match is active (disabledAt null)", async () => {
    const existing = {
      id: 8,
      name: "正常用户",
      role: "editor",
      dingtalkId: "union-ok",
      disabledAt: null
    };

    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [existing]
          })
        })
      })
    };

    const db = {
      transaction: async <T>(fn: (inner: typeof tx) => Promise<T>): Promise<T> => fn(tx)
    } as unknown as DbClient;

    await expect(
      mergeOrCreateUser({ unionid: "union-ok", name: "正常用户", dept: null }, db)
    ).resolves.toEqual({
      id: 8,
      name: "正常用户",
      role: "editor",
      dingtalkId: "union-ok"
    });
  });

  it("UserDisabledError has stable name for provider catch", () => {
    const err = new UserDisabledError();
    expect(err.name).toBe("UserDisabledError");
    expect(err.message).toBe("User account is disabled");
    // Ensure provider can use instanceof after rethrow paths
    expect(err).toBeInstanceOf(Error);
  });
});
