import { and, eq, isNull } from "drizzle-orm";
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

    const decision = decideMergeAction(false, candidates.length);
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
          mergedFromUserId: target.id
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
    dingtalkId: user.dingtalkId ?? unionid
  };
}
