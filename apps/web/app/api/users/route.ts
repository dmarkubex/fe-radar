import { desc, eq } from "drizzle-orm";
import { getDb, mergeConflicts, users } from "@fe-radar/db";

export async function GET(): Promise<Response> {
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
