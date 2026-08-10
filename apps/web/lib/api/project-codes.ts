/**
 * T-SEC-09 / S4: web 侧项目代号字典加载器（MiroFish scrubber 用）。
 * web 不能 import worker 的 loadProjectCodes（apps/web 与 apps/worker 不互相 import），
 * 所以这里直接查 project_codes 表 + 自带 5min 缓存（同 worker 侧模式）。
 *
 * 三种状态与 worker 对齐：
 *   1) 从未成功加载 + 本次失败 → throw（fail-closed，阻断公网 LLM）
 *   2) 曾成功加载 + 本次 DB 抖动 → 沿用上次快照
 *   3) 加载成功且表空 → 返回 []（合法）
 */
import { isNull } from "drizzle-orm";
import { getDb, projectCodes } from "@fe-radar/db";

const PROJECT_CODES_TTL_MS = 5 * 60 * 1000;
let cache: { codes: string[]; expiresAt: number } | null = null;

export async function loadProjectCodes(): Promise<string[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.codes;
  }

  try {
    const db = getDb();
    const rows = await db.select({ code: projectCodes.code })
      .from(projectCodes)
      .where(isNull(projectCodes.disabledAt));

    const codes = rows.map((r) => r.code).filter((c) => c.trim().length > 0);
    // 成功即写快照（含空数组），标记已初始化。
    cache = { codes, expiresAt: now + PROJECT_CODES_TTL_MS };
    return codes;
  } catch (err) {
    if (cache !== null) {
      return cache.codes;
    }
    throw err instanceof Error
      ? err
      : new Error("PROJECT_CODES_NOT_INITIALIZED: project_codes dictionary never successfully loaded");
  }
}

/** 仅供测试清缓存使用。 */
export function __clearProjectCodesCacheForTests(): void {
  cache = null;
}
