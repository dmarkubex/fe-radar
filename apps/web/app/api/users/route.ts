import { desc, eq } from "drizzle-orm";
import { auditLogs, getDb, mergeConflicts, users } from "@fe-radar/db";
import { requireFreshRole, getRequestUser } from "@/lib/api/authz";
import { createUserSchema, validationError } from "@/lib/api/users-schema";
import { hashPassword } from "@/lib/auth/password";

import type { NextRequest } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "admin");
  if (authError) return authError;

  const [userRows, conflictRows] = await Promise.all([
    getDb().select({
      id: users.id,
      username: users.username,
      dingtalkId: users.dingtalkId,
      name: users.name,
      dept: users.dept,
      role: users.role,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt
    }).from(users).orderBy(desc(users.id)),
    getDb().select().from(mergeConflicts).where(eq(mergeConflicts.status, "pending")).orderBy(desc(mergeConflicts.createdAt))
  ]);
  return Response.json({ users: userRows, mergeConflicts: conflictRows });
}

export async function POST(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "admin");
  if (authError) return authError;

  const actor = await getRequestUser(request);
  const db = getDb();
  const parsed = createUserSchema.safeParse(await request.json());
  if (!parsed.success) {
    return validationError(parsed.error.flatten());
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, parsed.data.username));
  if (existing) {
    return Response.json({ error: { code: "USERNAME_TAKEN", message: "用户名已存在" } }, { status: 409 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const [newUser] = await db.insert(users).values({
    username: parsed.data.username,
    passwordHash,
    name: parsed.data.name,
    dept: parsed.data.dept ?? null,
    role: parsed.data.role
  }).returning({
    id: users.id,
    username: users.username,
    name: users.name,
    dept: users.dept,
    role: users.role,
    createdAt: users.createdAt
  });
  if (!newUser) {
    return Response.json({ error: { code: "CREATE_USER_FAILED", message: "用户创建失败" } }, { status: 500 });
  }

  await db.insert(auditLogs).values({
    action: "create_user",
    actorUserId: actor.id,
    targetUserId: newUser.id,
    meta: { username: parsed.data.username, role: parsed.data.role }
  });
  return Response.json(newUser, { status: 201 });
}
