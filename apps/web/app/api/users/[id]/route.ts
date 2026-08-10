import { and, count, eq, isNull, ne, sql } from "drizzle-orm";
import { auditLogs, getDb, mergeConflicts, users } from "@fe-radar/db";
import { getRequestUser, requireFreshRole } from "@/lib/api/authz";
import { mergeConflictActionSchema, updateUserSchema, validationError } from "@/lib/api/users-schema";

import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<Response> {
  // T-SEC-06 (复核 HIGH-3): 改角色/禁用是 admin 高权限动作，查 DB 校验 token 新鲜度。
  const freshError = await requireFreshRole(request, "admin");
  if (freshError) return freshError;
  const { id } = await context.params;
  const userId = Number(id);
  const actor = await getRequestUser(request);
  const parsed = updateUserSchema.safeParse(await request.json());
  if (!parsed.success) {
    return validationError(parsed.error.flatten());
  }

  if (actor.id === userId && parsed.data.role && parsed.data.role !== "admin") {
    return Response.json({ error: { code: "FORBIDDEN", message: "不能降低自己的 admin 权限" } }, { status: 403 });
  }

  if (actor.id === userId && parsed.data.disabled === true) {
    return Response.json({ error: { code: "FORBIDDEN", message: "不能停用自己的账号" } }, { status: 403 });
  }

  const db = getDb();
  if (parsed.data.disabled === true) {
    const [adminCount] = await db.select({ total: count() }).from(users).where(and(eq(users.role, "admin"), isNull(users.disabledAt), ne(users.id, userId)));
    if ((adminCount?.total ?? 0) === 0) {
      return Response.json({ error: { code: "FORBIDDEN", message: "不能停用最后一个活跃 admin" } }, { status: 403 });
    }
  }

  if (parsed.data.role && parsed.data.role !== "admin") {
    const [target] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
    if (target?.role === "admin") {
      const [adminCount] = await db.select({ total: count() }).from(users).where(and(eq(users.role, "admin"), isNull(users.disabledAt), ne(users.id, userId)));
      if ((adminCount?.total ?? 0) === 0) {
        return Response.json({ error: { code: "FORBIDDEN", message: "不能降级最后一个活跃 admin" } }, { status: 403 });
      }
    }
  }

  const [updated] = await db
    .update(users)
    .set({
      role: parsed.data.role,
      // T-SEC-06: 改角色/禁用都递增 token_version，让旧 JWT 在下一次特权请求被拒。
      tokenVersion: sql`${users.tokenVersion} + 1`,
      disabledAt: parsed.data.disabled === undefined ? undefined : parsed.data.disabled ? new Date() : null
    })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      username: users.username,
      dingtalkId: users.dingtalkId,
      name: users.name,
      dept: users.dept,
      role: users.role,
      disabledAt: users.disabledAt,
      tokenVersion: users.tokenVersion,
      createdAt: users.createdAt
    });

  if (!updated) {
    return Response.json({ error: { code: "NOT_FOUND", message: "用户不存在" } }, { status: 404 });
  }

  await db.insert(auditLogs).values({
    action: "admin_update_user",
    actorUserId: actor.id,
    targetUserId: userId,
    meta: parsed.data
  });
  // T-SEC-11: 仅返回公共字段，绝不序列化 passwordHash（旧代码用裸 .returning() 会泄露 bcrypt verifier）。
  return Response.json(updated);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  // T-SEC-06 (复核 HIGH-3): 合并冲突确认是 admin 高权限动作。
  const freshError = await requireFreshRole(request, "admin");
  if (freshError) return freshError;
  const { id } = await context.params;
  const conflictId = Number(id);
  const actor = await getRequestUser(request);
  const parsed = mergeConflictActionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return validationError(parsed.error.flatten());
  }

  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [conflict] = await tx.select().from(mergeConflicts).where(eq(mergeConflicts.id, conflictId)).limit(1);
    if (!conflict) {
      return null;
    }
    if (parsed.data.action === "reject") {
      const [updatedConflict] = await tx.update(mergeConflicts).set({ status: "rejected", resolvedBy: actor.id, resolvedAt: new Date() }).where(eq(mergeConflicts.id, conflictId)).returning();
      await tx.insert(auditLogs).values({ action: "merge_conflict_reject", actorUserId: actor.id, meta: { conflictId } });
      return updatedConflict;
    }
    const targetUserId = parsed.data.targetUserId;
    if (!targetUserId || !conflict.candidateIds.includes(targetUserId)) {
      throw new Error("target user is not a conflict candidate");
    }
    const mergedAt = new Date();
    await tx
      .update(users)
      .set({
        dingtalkId: `${conflict.unionid}#merged#${targetUserId}`,
        disabledAt: mergedAt,
        mergedAt,
        mergedFromUserId: targetUserId
      })
      .where(eq(users.dingtalkId, conflict.unionid));
    await tx.update(users).set({ dingtalkId: conflict.unionid, mergedAt, mergedFromUserId: targetUserId, tokenVersion: sql`${users.tokenVersion} + 1` }).where(eq(users.id, targetUserId));
    const [updatedConflict] = await tx.update(mergeConflicts).set({ status: "confirmed", resolvedBy: actor.id, resolvedAt: new Date() }).where(eq(mergeConflicts.id, conflictId)).returning();
    await tx.insert(auditLogs).values({ action: "merge_conflict_confirm", actorUserId: actor.id, targetUserId, meta: { conflictId, unionid: conflict.unionid } });
    return updatedConflict;
  });

  if (!result) {
    return Response.json({ error: { code: "NOT_FOUND", message: "合并冲突不存在" } }, { status: 404 });
  }
  return Response.json(result);
}
