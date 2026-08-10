import pino from "pino";

import { getDb, entities, projectCodes, scoringConfig } from "@fe-radar/db";
import { and, eq, isNull } from "drizzle-orm";
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
  /** T-SEC-09: 项目代号字典，注入 withScrubber 防内部代号泄露给公网 LLM。 */
  projectCodes: string[];
}

export const handlerContext: HandlerContext = {
  qwen: undefined as unknown as LlmClient,
  deepSeek: undefined as unknown as LlmClient,
  kimi: undefined as unknown as LlmClient,
  playwrightPool: undefined,
  projectCodes: []
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

/**
 * T-SEC-09 / S4: 加载项目代号字典（project_codes 表，disabled_at IS NULL）。
 * 注入 withScrubber context.projectCodes，让 scrubber 在公网 LLM 调用前把**真实代号**
 * 替换为 [REDACTED:PROJECT_CODE:…]（方向：出网脱敏，不是还原）。
 * 5min 内存缓存（同 loadOwnCompanyProfile 模式）：project_codes 表低频变更。
 *
 * 三种状态（S4 缺陷 B：禁止「从未初始化」与「合法空字典」混为一谈）：
 *   1) 从未成功加载过（cache === null）且本次 DB 失败 → **fail-closed** 抛错，阻断公网 LLM
 *   2) 曾成功加载、本次 DB 抖动 → 沿用上次快照（可为空数组；保留既有 fail-open-on-jitter）
 *   3) 加载成功且表空（admin 未配代号）→ 放行，返回 []（合法状态）
 *
 * 区分手段：快照对象存在（含 codes:[]） vs 快照为 null；不能只看数组是否为空。
 */
const PROJECT_CODES_TTL_MS = 5 * 60 * 1000;
let projectCodesCache: { codes: string[]; expiresAt: number } | null = null;

export async function loadProjectCodes(): Promise<string[]> {
  const now = Date.now();
  if (projectCodesCache && projectCodesCache.expiresAt > now) {
    return projectCodesCache.codes;
  }

  try {
    const db = getDb();
    const rows = await db.select({ code: projectCodes.code })
      .from(projectCodes)
      .where(isNull(projectCodes.disabledAt));

    const codes = rows.map((r) => r.code).filter((c) => c.trim().length > 0);
    // 成功即写快照——即使 codes 为空，也标记「已初始化」，与 never-loaded 区分。
    projectCodesCache = { codes, expiresAt: now + PROJECT_CODES_TTL_MS };
    return codes;
  } catch (err) {
    if (projectCodesCache !== null) {
      // 有过成功快照：DB 抖动沿用上次结果（可为空），避免一次抖动清空字典导致代号外发。
      logger.warn(
        { err, hasSnapshot: true, snapshotSize: projectCodesCache.codes.length },
        "loadProjectCodes failed; keeping last successful snapshot"
      );
      return projectCodesCache.codes;
    }
    // 从未成功加载：fail-closed，阻断公网 LLM（daily-gen / briefing-gen / pipeline scrub 路径会失败而非静默放行）。
    logger.error(
      { err, hasSnapshot: false },
      "loadProjectCodes failed with no prior snapshot; blocking public LLM calls"
    );
    throw err instanceof Error
      ? err
      : new Error("PROJECT_CODES_NOT_INITIALIZED: project_codes dictionary never successfully loaded");
  }
}

/** 仅供测试清缓存使用。 */
export function __clearProjectCodesCacheForTests(): void {
  projectCodesCache = null;
}
