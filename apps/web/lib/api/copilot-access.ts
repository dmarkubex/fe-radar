import { eq } from "drizzle-orm";
import { copilotFeatureFlags, getDb, users } from "@fe-radar/db";

import type { DbClient } from "@fe-radar/db";

/**
 * 灰度谓词（design §3.3.0）。抛错由调用方视为未通过；本函数不吞 DB 错误。
 */
export async function evaluateCopilotAccess(
  userId: number,
  options: { db?: DbClient } = {}
): Promise<boolean> {
  const db = options.db ?? getDb();
  const [flag] = await db
    .select({
      enabled: copilotFeatureFlags.enabled,
      userIds: copilotFeatureFlags.userIds,
      depts: copilotFeatureFlags.depts
    })
    .from(copilotFeatureFlags)
    .where(eq(copilotFeatureFlags.key, "copilot"))
    .limit(1);

  if (!flag || !flag.enabled) {
    return false;
  }

  const userIds = flag.userIds ?? [];
  const depts = flag.depts ?? [];
  if (userIds.length === 0 && depts.length === 0) {
    return false;
  }

  const [user] = await db
    .select({ dept: users.dept })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const dept = user?.dept ?? null;
  return userIds.includes(userId) || (dept !== null && depts.includes(dept));
}

export function copilotDisabled(): Response {
  return Response.json(
    { error: { code: "COPILOT_DISABLED", message: "Copilot 未对当前账号开放" } },
    { status: 403 }
  );
}
