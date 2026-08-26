import { eq } from "drizzle-orm";
import { copilotFeatureFlags, getDb, users } from "@fe-radar/db";

import type { DbClient } from "@fe-radar/db";

const COPILOT_ACCESS_TTL_MS = 60_000;
const accessCache = new Map<number, { value: boolean; expiresAt: number }>();

export function clearCopilotAccessCache(): void {
  accessCache.clear();
}

/**
 * 灰度谓词（design §3.3.0）。抛错由调用方视为未通过；本函数不吞 DB 错误。
 * 默认路径按 userId 进程内缓存 60s；注入 db 时跳过缓存（不读不写）。失败不入缓存。
 */
export async function evaluateCopilotAccess(
  userId: number,
  options: { db?: DbClient } = {}
): Promise<boolean> {
  const cacheable = options.db === undefined;
  if (cacheable) {
    const hit = accessCache.get(userId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }

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

  let value: boolean;
  if (!flag || !flag.enabled) {
    value = false;
  } else {
    const userIds = flag.userIds ?? [];
    const depts = flag.depts ?? [];
    if (userIds.length === 0 && depts.length === 0) {
      value = false;
    } else {
      const [user] = await db
        .select({ dept: users.dept })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const dept = user?.dept ?? null;
      value = userIds.includes(userId) || (dept !== null && depts.includes(dept));
    }
  }

  if (cacheable) {
    accessCache.set(userId, { value, expiresAt: Date.now() + COPILOT_ACCESS_TTL_MS });
  }
  return value;
}

export function copilotDisabled(): Response {
  return Response.json(
    { error: { code: "COPILOT_DISABLED", message: "Copilot 未对当前账号开放" } },
    { status: 403 }
  );
}
