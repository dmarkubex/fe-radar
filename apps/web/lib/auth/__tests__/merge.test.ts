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

describe("mergeOrCreateUser privileged-inheritance guard (T-SEC-01)", () => {
  // 单候选 editor/admin 不再 auto_merge —— 写 conflict + 建 viewer，让 admin 在合并冲突页确认。
  function makeTx(candidate: { id: number; name: string; role: string; dept: string | null }) {
    const conflictRow = { id: 99, unionid: "u-priv", candidateIds: [candidate.id] };
    const createdViewer = {
      id: 50, name: candidate.name, role: "viewer", dept: candidate.dept,
      dingtalkId: "u-priv", disabledAt: null
    };
    let selectCount = 0;
    let insertCount = 0;
    return {
      select: () => ({
        from: () => ({
          where: () => {
            selectCount += 1;
            // 1st select: unionid match → []（链 .limit）；2nd select: candidates → [candidate]
            const result = selectCount === 2 ? [candidate] : [];
            // 既是 awaitable（candidates 路径）又有 .limit()（unionid 路径）。
            return {
              limit: async () => result,
              then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
            };
          }
        })
      }),
      insert: () => ({
        // 1st insert: mergeConflicts; 2nd insert: audit log; 3rd insert: new viewer
        values: () => {
          insertCount += 1;
          let result: unknown[] = [{}];
          if (insertCount === 1) result = [conflictRow];
          if (insertCount === 3) result = [createdViewer];
          return {
            returning: async () => result,
            // audit 路径 await .values()：返回 result（不报错即可）
            then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
          };
        }
      }),
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [{}] }) }) })
    };
  }

  it("does NOT auto-merge a single editor candidate (creates conflict + viewer)", async () => {
    const tx = makeTx({ id: 7, name: "张三", role: "editor", dept: "采购" });
    const db = {
      transaction: async <T>(fn: (inner: typeof tx) => Promise<T>): Promise<T> => fn(tx)
    } as unknown as DbClient;

    const result = await mergeOrCreateUser({ unionid: "u-priv", name: "张三", dept: "采购" }, db);
    expect(result.role).toBe("viewer"); // 不继承 editor
    expect(result.id).toBe(50); // 新建 viewer，不是候选 7
    expect(result.conflictId).toBe(99); // 写了冲突待 admin 确认
  });

  it("does NOT auto-merge a single admin candidate (creates conflict + viewer)", async () => {
    const tx = makeTx({ id: 8, name: "李四", role: "admin", dept: "产业情报" });
    const db = {
      transaction: async <T>(fn: (inner: typeof tx) => Promise<T>): Promise<T> => fn(tx)
    } as unknown as DbClient;

    const result = await mergeOrCreateUser({ unionid: "u-priv", name: "李四", dept: "产业情报" }, db);
    expect(result.role).toBe("viewer");
    expect(result.conflictId).toBe(99);
  });
});
