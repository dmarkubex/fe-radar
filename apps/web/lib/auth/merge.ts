import { and, eq, isNull, sql } from "drizzle-orm";
import { auditLogs, getDb, mergeConflicts, users } from "@fe-radar/db";

import type { DbClient } from "@fe-radar/db";
import type { UserRole } from "@fe-radar/shared";

export interface MergeInput {
  unionid: string;
  name: string;
  dept?: string | null;
}

export interface MergeUserResult {
  id: number;
  name: string;
  role: UserRole;
  dingtalkId: string;
  /** 复核 F8: 钉钉登录也需要 tokenVersion 写入 JWT，否则撤权对钉钉会话无效。 */
  tokenVersion: number;
  conflictId?: number;
}

export type MergeDecision = "existing" | "auto_merge" | "conflict_new_user" | "new_user";

/** Thrown when a dingtalk_id match exists but disabled_at is set (scan + in-app share this gate). */
export class UserDisabledError extends Error {
  constructor() {
    super("User account is disabled");
    this.name = "UserDisabledError";
  }
}

/** T-SEC-01: editor/admin 是特权账号 —— 姓名+部门碰撞不足以证明所有权，必须 admin 确认。 */
function isPrivileged(role: string | null): boolean {
  return role === "editor" || role === "admin";
}

export function decideMergeAction(existingByUnionid: boolean, candidateCount: number): MergeDecision {
  if (existingByUnionid) {
    return "existing";
  }
  if (candidateCount === 1) {
    return "auto_merge";
  }
  if (candidateCount > 1) {
    return "conflict_new_user";
  }
  return "new_user";
}

export async function mergeOrCreateUser(input: MergeInput, db: DbClient = getDb()): Promise<MergeUserResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(eq(users.dingtalkId, input.unionid)).limit(1);
    if (existing) {
      // FR-05a: disabled accounts must be rejected for both QR and in-app free-login.
      if (existing.disabledAt != null) {
        throw new UserDisabledError();
      }
      return toResult(existing, input.unionid);
    }

    const deptCondition = input.dept ? eq(users.dept, input.dept) : isNull(users.dept);
    const candidates = await tx
      .select()
      .from(users)
      .where(and(eq(users.name, input.name), deptCondition, isNull(users.dingtalkId), isNull(users.disabledAt)));

    // T-SEC-01: 唯一候选若为 editor/admin，姓名+部门碰撞不足以证明该钉钉用户拥有该特权
    // 账号 —— 不自动合并，按 conflict_new_user 处理（写冲突 + 建 viewer），让 admin 在
    // 合并冲突页确认。viewer 候选仍可 auto_merge（不回归）。
    const hasPrivilegedCandidate = candidates.some((c) => isPrivileged(c.role));
    const decision = hasPrivilegedCandidate ? "conflict_new_user" : decideMergeAction(false, candidates.length);
    if (decision === "auto_merge") {
      const target = candidates[0];
      if (!target) {
        throw new Error("merge candidate disappeared");
      }
      const [merged] = await tx
        .update(users)
        .set({
          dingtalkId: input.unionid,
          mergedAt: new Date(),
          mergedFromUserId: target.id,
          // T-SEC-06: 合并绑定递增 token_version，让该账号此前可能的本地登录会话失效。
          tokenVersion: sql`${users.tokenVersion} + 1`
        })
        .where(eq(users.id, target.id))
        .returning();
      if (!merged) {
        throw new Error("merge update failed");
      }
      await tx.insert(auditLogs).values({
        action: "dingtalk_auto_merge",
        targetUserId: target.id,
        meta: { unionid: input.unionid, name: input.name, dept: input.dept ?? null }
      });
      return toResult(merged, input.unionid);
    }

    let conflictId: number | undefined;
    if (decision === "conflict_new_user") {
      const [conflict] = await tx
        .insert(mergeConflicts)
        .values({
          unionid: input.unionid,
          name: input.name,
          dept: input.dept ?? null,
          candidateIds: candidates.map((candidate) => candidate.id)
        })
        .returning();
      if (!conflict) {
        throw new Error("merge conflict insert failed");
      }
      conflictId = conflict.id;
      await tx.insert(auditLogs).values({
        action: "dingtalk_merge_conflict",
        meta: { unionid: input.unionid, candidateIds: candidates.map((candidate) => candidate.id) }
      });
    }

    const [created] = await tx
      .insert(users)
      .values({
        dingtalkId: input.unionid,
        name: input.name,
        dept: input.dept ?? null,
        role: "viewer"
      })
      .returning();
    if (!created) {
      throw new Error("dingtalk user create failed");
    }
    await tx.insert(auditLogs).values({
      action: "dingtalk_create_user",
      targetUserId: created.id,
      meta: { unionid: input.unionid, conflictId: conflictId ?? null }
    });
    return { ...toResult(created, input.unionid), conflictId };
  });
}

function toResult(user: typeof users.$inferSelect, unionid: string): MergeUserResult {
  return {
    id: user.id,
    name: user.name,
    role: user.role as UserRole,
    dingtalkId: user.dingtalkId ?? unionid,
    tokenVersion: user.tokenVersion
  };
}
