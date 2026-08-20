import { entities, getDb } from "@fe-radar/db";
import { createLogger } from "@fe-radar/shared";
import { eq } from "drizzle-orm";

import type { StandardItem } from "../types";

const logger = createLogger({ service: "announcement-entity-filter" });

/** 巨潮空格分隔、深交所全角冒号；兼顾客标题里的半角冒号与全角空格。 */
export const DEFAULT_ENTITY_FILTER_SEPARATORS = [" ", "\u3000", "：", ":"];

export interface CompanyNameRow {
  canonicalName: string;
  aliases: string[] | null;
}

export interface EntityFilterOptions {
  enabled: boolean;
  separators?: string[];
}

export interface EntityFilterStats {
  sourceName: string;
  total: number;
  kept: number;
  filtered: number;
}

/**
 * 取标题第一个分隔符之前的部分作为公告主体公司名。
 * 标题里再出现分隔符（如「湖南裕能：…（H股）…」）不影响前缀。
 */
export function parseCompanyPrefix(
  title: string,
  separators: string[]
): string {
  let cut = title.length;
  for (const sep of separators) {
    if (sep.length === 0) continue;
    const index = title.indexOf(sep);
    if (index !== -1 && index < cut) {
      cut = index;
    }
  }
  return title.slice(0, cut);
}

/** 去掉市场后缀 / ST 前缀，并把全角空格折成半角，便于和词典对齐。 */
export function normalizeCompanyKey(raw: string): string {
  let value = raw
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
  value = value.replace(/[-－][A-Za-zＡ-Ｚ]+$/u, "");
  value = value.replace(/[（(]H股?[）)]$/u, "");
  value = value.replace(/^\*ST/u, "");
  value = value.replace(/^ST/u, "");
  return value.trim();
}

function addName(nameSet: Set<string>, name: string): void {
  const trimmed = name.trim();
  if (trimmed.length === 0) return;
  nameSet.add(trimmed);
  const normalized = normalizeCompanyKey(trimmed);
  if (normalized.length > 0) {
    nameSet.add(normalized);
  }
}

export function buildCompanyNameSet(rows: CompanyNameRow[]): Set<string> {
  const nameSet = new Set<string>();
  for (const row of rows) {
    addName(nameSet, row.canonicalName);
    for (const alias of row.aliases ?? []) {
      addName(nameSet, alias);
    }
  }
  return nameSet;
}

export function matchesCompanyName(
  prefix: string,
  nameSet: Set<string>
): boolean {
  const raw = prefix.trim();
  if (raw.length === 0) return false;
  if (nameSet.has(raw)) return true;
  const normalized = normalizeCompanyKey(raw);
  return normalized.length > 0 && nameSet.has(normalized);
}

export function resolveEntityFilterSeparators(
  options: EntityFilterOptions
): string[] {
  if (options.separators && options.separators.length > 0) {
    return options.separators;
  }
  return DEFAULT_ENTITY_FILTER_SEPARATORS;
}

export function filterAnnouncementsByEntity(
  items: StandardItem[],
  nameSet: Set<string>,
  separators: string[]
): StandardItem[] {
  return items.filter((item) => {
    const prefix = parseCompanyPrefix(item.title, separators);
    return matchesCompanyName(prefix, nameSet);
  });
}

export async function loadCompanyNameRows(
  db: ReturnType<typeof getDb> = getDb()
): Promise<CompanyNameRow[]> {
  return db
    .select({
      canonicalName: entities.canonicalName,
      aliases: entities.aliases
    })
    .from(entities)
    .where(eq(entities.type, "company"));
}

/**
 * 一次抓取只查一次词典（按源缓存），再对条目做公司名匹配。
 * 过滤后 0 条是业务空窗：打 info 并返回 []，不抛错。
 */
export function applyAnnouncementEntityFilter(
  items: StandardItem[],
  nameSet: Set<string>,
  sourceName: string,
  separators: string[] = DEFAULT_ENTITY_FILTER_SEPARATORS
): StandardItem[] {
  const kept = filterAnnouncementsByEntity(items, nameSet, separators);
  const stats: EntityFilterStats = {
    sourceName,
    total: items.length,
    kept: kept.length,
    filtered: items.length - kept.length
  };
  logger.info(stats, "announcement entity filter applied");
  return kept;
}
