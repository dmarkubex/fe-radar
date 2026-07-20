import pino from "pino";

import { getDb, entities, scoringConfig } from "@fe-radar/db";
import { and, eq } from "drizzle-orm";
import type { LlmClient } from "@fe-radar/llm";
import type { ScoringConfig as CoreScoringConfig, OwnCompanyProfile } from "@fe-radar/core";
import { ownCompanyProfileFromNames, DEFAULT_OWN_COMPANY_PROFILE } from "@fe-radar/core";

import { EntityDictionary } from "../lib/entities-dict";
import type { BrowserContextPool } from "../fetchers/playwright";

export const logger = pino({ name: "fe-radar-worker" });

// LLM client singletons + playwright pool. These are wired by bootstrap
// (startWorker) before any worker begins processing jobs, and read by the
// pipeline handlers. Kept as a single mutable context object so handlers can
// share the same wiring without circular imports.
export interface HandlerContext {
  qwen: LlmClient;
  deepSeek: LlmClient;
  kimi: LlmClient;
  playwrightPool?: BrowserContextPool;
}

export const handlerContext: HandlerContext = {
  qwen: undefined as unknown as LlmClient,
  deepSeek: undefined as unknown as LlmClient,
  kimi: undefined as unknown as LlmClient,
  playwrightPool: undefined,
};

// Dev/test-only fallbacks. Production MUST source scoring config from the DB
// (CLAUDE.md 硬约束: "配置必须存数据库，不许硬编码阈值"). These defaults exist
// only so local/mock runs without a seeded DB don't crash — in production a
// missing row is a misconfiguration and we fail fast instead of silently using
// stale hardcoded values that diverge from admin edits.
const SCORING_CONFIG_DEV_FALLBACK = {
  weights: { w1: 0.20, w2: 0.25, w3: 0.20, w4: 0.15, w5: 0.20 },
  t_coef: { T1: 1.0, T2: 0.85, T3: 0.70 },
  c_coef: { C1: 1.2, C2: 1.0, C3: 0.85 },
  thresholds: {
    "政策与标准": { C1: 55, C2: 60, C3: 65 },
    "市场与价格": { C1: 55, C2: 60, C3: 70 },
    "技术与产品": { C1: 55, C2: 65, C3: 75 },
    "项目与招投标": { C1: 50, C2: 60, C3: 70 },
    "公司与资本": { C1: 55, C2: 65, C3: 75 },
  },
} as const;

function requireScoringConfig<T>(value: T | undefined, key: string, fallback: T): T {
  if (value !== undefined) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `scoring_config 缺少 '${key}' 行：生产环境评分配置必须存数据库（请运行 seed 或在 admin 后台补全），不允许硬编码兜底`
    );
  }
  logger.warn({ key }, "scoring_config 缺失，使用 dev 兜底值（生产环境会 fail-fast）");
  return fallback;
}

export async function loadScoringConfig(): Promise<CoreScoringConfig> {
  const db = getDb();
  const rows = await db.select().from(scoringConfig);
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value as Record<string, unknown>]));
  return {
    weights: requireScoringConfig(
      byKey.weights as CoreScoringConfig["weights"] | undefined,
      "weights",
      SCORING_CONFIG_DEV_FALLBACK.weights
    ),
    tCoef: requireScoringConfig(
      byKey.t_coef as CoreScoringConfig["tCoef"] | undefined,
      "t_coef",
      SCORING_CONFIG_DEV_FALLBACK.t_coef
    ),
    cCoef: requireScoringConfig(
      byKey.c_coef as CoreScoringConfig["cCoef"] | undefined,
      "c_coef",
      SCORING_CONFIG_DEV_FALLBACK.c_coef
    ),
    thresholds: requireScoringConfig(
      byKey.thresholds as CoreScoringConfig["thresholds"] | undefined,
      "thresholds",
      SCORING_CONFIG_DEV_FALLBACK.thresholds
    ),
  };
}

export async function loadEntityDictionary(): Promise<EntityDictionary> {
  const db = getDb();
  const rows = await db.select({
    id: entities.id,
    type: entities.type,
    canonicalName: entities.canonicalName,
    aliases: entities.aliases,
    circle: entities.circle,
  }).from(entities);
  return new EntityDictionary(rows.map((r) => ({
    id: r.id,
    type: r.type,
    canonicalName: r.canonicalName,
    aliases: r.aliases ?? [],
    circle: r.circle as "C1" | "C2" | "C3" | null,
  })));
}

/**
 * 本公司 OwnCompanyProfile（注入 core 单一入口，design §11.1）：
 *
 * - 查 DB `entities` 中 `circle='C1' AND type='company'` 的实体；
 * - 用 DEFAULT_OWN_COMPANY_PROFILE.names（远东同义词种子）定位「远东系」实体——canonicalName
 *   或 aliases 任一命中种子即视为远东系；
 * - 收集所有命中实体的 `canonicalName + aliases` 全集，过 ownCompanyProfileFromNames（trim + 过滤 <3 字）。
 *
 * 这样 admin 在后台给远东系实体新增别名（如"远东通讯"）会自动进入 profile，无需改代码，
 * 满足"配置必须存数据库"硬约束。core 侧仍保持纯函数、不依赖 db（AGENTS.md 模块边界）。
 *
 * 5min 内存缓存（design §11.1 原意）：避免每条 item 都查 DB；entities 表低频变更。
 */
const OWN_COMPANY_PROFILE_TTL_MS = 5 * 60 * 1000;
let ownCompanyProfileCache: { profile: OwnCompanyProfile; expiresAt: number } | null = null;

export async function loadOwnCompanyProfile(): Promise<OwnCompanyProfile> {
  const now = Date.now();
  if (ownCompanyProfileCache && ownCompanyProfileCache.expiresAt > now) {
    return ownCompanyProfileCache.profile;
  }

  const db = getDb();
  const rows = await db.select({
    canonicalName: entities.canonicalName,
    aliases: entities.aliases,
  })
    .from(entities)
    .where(and(eq(entities.circle, "C1"), eq(entities.type, "company")));

  const seeds = DEFAULT_OWN_COMPANY_PROFILE.names;
  const collected = new Set<string>();
  let matchedAny = false;
  for (const row of rows) {
    const names = [row.canonicalName, ...(row.aliases ?? [])];
    const hit = names.some((n) => seeds.has(n.trim()));
    if (!hit) continue;
    matchedAny = true;
    for (const n of names) {
      const trimmed = n.trim();
      if (trimmed.length >= 3) collected.add(trimmed);
    }
  }

  // DB 无远东系实体时（如本地 mock / 未 seed），回退默认 profile，避免 own 通道失效。
  const profile = matchedAny
    ? ownCompanyProfileFromNames([...collected])
    : DEFAULT_OWN_COMPANY_PROFILE;

  ownCompanyProfileCache = { profile, expiresAt: now + OWN_COMPANY_PROFILE_TTL_MS };
  return profile;
}

/** 仅供测试清缓存使用（生产路径无需调用）。 */
export function __clearOwnCompanyProfileCacheForTests(): void {
  ownCompanyProfileCache = null;
}
