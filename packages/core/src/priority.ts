import type { EntityHit, OwnCompanyProfile, ScoreAtoms } from "./types";

/**
 * 远东同义词组（requirements §9.1 own 通道；不含 C1 核心客户/监管）。
 *
 * 注意：本列表**仅作为兜底默认值**与「worker 侧定位远东系 DB 实体」的初始种子。
 * 生产判定走注入的 {@link OwnCompanyProfile}（由 worker 从 `entities` 表构造，见
 * `apps/worker/src/handlers/context.ts#loadOwnCompanyProfile`），admin 后台增删远东
 * 别名无需改代码。
 *
 * 故意**不含** 2 字的 `"远东"`：之前的子串兜底会把「上海远东仪表厂」「大连远东工具」
 * 等任何含「远东」子串的实体误判为本公司（2026-07-13 对抗评审 Finding #4）。剩余条目
 * 均 ≥3 字且更特异。
 */
export const OWN_COMPANY_NAMES = [
  "远东控股",
  "远东控股集团",
  "远东电缆",
  "远东智慧能源",
  "远东智慧能源股份",
  "远东股份",
  "远东智慧",
] as const;

/**
 * 本公司判定集合（注入式）：worker 侧从 DB `entities`（circle=C1 + type=company +
 * 命中远东系种子的实体）的 canonicalName + aliases 全集构造，core 仅做**精确等值**。
 *
 * 设计依据 design §11.1：`getOwnCompanyEntityIds()` 由 worker 查 DB 后注入，core 保持
 * 纯函数不依赖 db（AGENTS.md 模块边界硬约束）。所有 name 经 trim 且长度 ≥3 才入集合，
 * 杜绝 2 字短词的子串误判。类型本体定义在 `./types`（避免 priority↔types 循环 import）。
 */
export type { OwnCompanyProfile } from "./types";

/** 从名字列表构造 profile：trim 后过滤掉 <3 字的短词（防子串误判）。 */
export function ownCompanyProfileFromNames(names: readonly string[]): OwnCompanyProfile {
  const cleaned = names
    .map((n) => n.trim())
    .filter((n) => n.length >= 3);
  return { names: new Set(cleaned) };
}

/** 兜底默认 profile（仅用于单测 / worker 未注入场景）。生产路径必须注入 DB profile。 */
export const DEFAULT_OWN_COMPANY_PROFILE: OwnCompanyProfile = ownCompanyProfileFromNames(
  OWN_COMPANY_NAMES as readonly string[]
);

/** design §5.1 入队前事故关键词（零 LLM） */
export const SAFETY_PRIORITY_KEYWORDS = [
  "火灾",
  "爆炸",
  "停电",
  "触电",
  "死亡",
  "坍塌",
  "伤亡",
  "事故",
] as const;

/** design §5.1 政策号格式 */
export const POLICY_NUMBER_PATTERNS: readonly RegExp[] = [
  /GB\/T\s*\d+/i,
  /〔20\d{2}〕\s*\d+\s*号/,
  /\[\s*20\d{2}\s*\]\s*\d+\s*号/,
];

/**
 * 判定 name 是否为本公司：**仅精确等值**（trim 后属于 profile.names）。
 *
 * 不再用 `trimmed.includes(alias)` 子串兜底——那是 2026-07-13 Finding #4 的误判根因
 * （"上海远东仪表厂" 含 "远东" 子串被误判）。NER 实体的 canonicalName 是规范名，
 * 精确等值即够；worker 注入的 profile 已含全部别名。
 */
export function isOwnCompanyName(
  name: string,
  profile: OwnCompanyProfile = DEFAULT_OWN_COMPANY_PROFILE
): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  return profile.names.has(trimmed);
}

export function isOwnCompanyEntity(
  entity: Pick<EntityHit, "canonicalName">,
  profile: OwnCompanyProfile = DEFAULT_OWN_COMPANY_PROFILE
): boolean {
  return isOwnCompanyName(entity.canonicalName, profile);
}

/**
 * 抓取入队前的高优先级判定（design §5.1）：
 * 1. 远东同义词（精确 name 做 includes，误判面远小于原子串兜底）
 * 2. 事故关键词  3. 政策号格式
 *
 * 注：此处是**文本检索**（入队前无 NER 实体），故仍用 includes，但只用 profile 里的
 * 精确名（≥3 字，如"远东智慧能源"），不会误中"上海远东仪表厂"。
 */
export function detectPriorityFromText(
  title: string,
  content?: string,
  profile: OwnCompanyProfile = DEFAULT_OWN_COMPANY_PROFILE
): boolean {
  const text = `${title}\n${content ?? ""}`;
  for (const name of profile.names) {
    if (text.includes(name)) return true;
  }
  if (SAFETY_PRIORITY_KEYWORDS.some((kw) => text.includes(kw))) {
    return true;
  }
  return POLICY_NUMBER_PATTERNS.some((re) => re.test(text));
}

export function isPriorityItem(
  entities: EntityHit[],
  scores: ScoreAtoms,
  profile: OwnCompanyProfile = DEFAULT_OWN_COMPANY_PROFILE
): boolean {
  return (
    entities.some((entity) => isOwnCompanyEntity(entity, profile) || entity.circle === "C1") ||
    scores.d1Policy >= 85 ||
    scores.d2Chain >= 85
  );
}

export interface BacklogItem {
  fetchedAt: Date;
  priority: boolean;
}

export interface BacklogMetrics {
  priorityBacklogAgeP95Seconds: number;
  priorityBacklogSize: number;
  priorityBacklogStaleRatio: number;
  isRed: boolean;
}

export function computePriorityBacklogMetrics(items: BacklogItem[], now = new Date()): BacklogMetrics {
  const priorityItems = items.filter((item) => item.priority);
  const ages = priorityItems.map((item) => Math.max(0, Math.floor((now.getTime() - item.fetchedAt.getTime()) / 1000))).sort((a, b) => a - b);
  const p95Index = ages.length === 0 ? 0 : Math.ceil(ages.length * 0.95) - 1;
  const staleCount = ages.filter((age) => age > 24 * 60 * 60).length;
  const staleRatio = priorityItems.length === 0 ? 0 : staleCount / priorityItems.length;
  return {
    priorityBacklogAgeP95Seconds: ages[p95Index] ?? 0,
    priorityBacklogSize: priorityItems.length,
    priorityBacklogStaleRatio: staleRatio,
    isRed: staleRatio > 0.3
  };
}
