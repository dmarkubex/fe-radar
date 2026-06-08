import pino from "pino";

import { getDb, entities, scoringConfig } from "@fe-radar/db";
import type { LlmClient } from "@fe-radar/llm";
import type { ScoringConfig as CoreScoringConfig } from "@fe-radar/core";

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
