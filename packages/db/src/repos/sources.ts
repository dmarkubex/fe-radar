import { AppError } from "@fe-radar/shared";
import { and, eq, ne, sql, type SQL } from "drizzle-orm";
import type { DbClient } from "../client";
import { sources } from "../schema";

export class ProtectedSourceUrlError extends AppError {
  public constructor() {
    super(
      "SOURCE_URL_PROTECTED",
      "该信源是行情数据 seed 源，URL 变更会被部署时的 migration 覆盖并造成重复行，请勿修改"
    );
  }
}

export class DuplicateEnabledSourceError extends AppError {
  public constructor(public readonly conflictingId: number) {
    super(
      "SOURCE_DUPLICATE_ENABLED",
      `同组已有启用的 URL 锁定信源 #${conflictingId}，启用此信源会造成双重抓取，请先停用另一行`
    );
  }
}

export type SourceTier = "T1" | "T2" | "T3";
export type FetcherType = "rss" | "html" | "playwright" | "quotes" | "announcement" | "crawl" | "datapro" | "websearch";

export interface SourceRecord {
  id: number;
  name: string;
  url: string;
  fetcherType: FetcherType;
  config: unknown;
  tier: SourceTier;
  category: string | null;
  enabled: boolean;
  lastOkAt: Date | null;
  failCount: number;
  lastError: string | null;
  lastErrorAt: Date | null;
  adminTouchedAt: Date | null;
  adminSnapshot: { enabled?: boolean; config?: unknown } | null;
  urlLocked: boolean;
  createdAt: Date;
}

export interface SourceCreateInput {
  name: string;
  url: string;
  fetcherType: FetcherType;
  config: unknown;
  tier: SourceTier;
  category?: string | null;
  enabled?: boolean;
}

export interface SourceUpdateInput {
  name?: string;
  url?: string;
  fetcherType?: FetcherType;
  config?: unknown;
  tier?: SourceTier;
  category?: string | null;
  enabled?: boolean;
  lastOkAt?: Date | null;
  failCount?: number;
  lastError?: string | null;
  lastErrorAt?: Date | null;
}

export interface SourceListFilters {
  tier?: SourceTier;
  category?: string;
  enabled?: boolean;
}

function filtersToWhere(filters: SourceListFilters): SQL | undefined {
  const clauses: SQL[] = [];
  if (filters.tier) clauses.push(eq(sources.tier, filters.tier));
  if (filters.category) clauses.push(eq(sources.category, filters.category));
  if (typeof filters.enabled === "boolean") clauses.push(eq(sources.enabled, filters.enabled));
  return clauses.length > 0 ? and(...clauses) : undefined;
}

function smmLogicalGroup(row: { url: string; fetcherType: string; config: unknown }): "cu" | "lc" | null {
  if (row.url === "https://hq.smm.cn/h5/cu") {
    return "cu";
  }
  if (row.url === "https://hq.smm.cn/h5/Li2CO3") {
    return "lc";
  }
  const config = row.config && typeof row.config === "object"
    ? row.config as Record<string, unknown>
    : {};
  if (row.fetcherType !== "quotes" || config.adapter !== "smm-hq") return null;
  const metricKeys = config.metric_keys;
  if (Array.isArray(metricKeys) && metricKeys.includes("cu_main_close")) return "cu";
  if (Array.isArray(metricKeys) && metricKeys.includes("lc_main_close")) return "lc";
  return null;
}

export async function listSources(db: DbClient, filters: SourceListFilters = {}): Promise<SourceRecord[]> {
  const where = filtersToWhere(filters);
  const query = db.select().from(sources).orderBy(sources.tier, sources.name);
  return (where ? query.where(where) : query) as unknown as Promise<SourceRecord[]>;
}

export async function listEnabledByTier(db: DbClient, tier: SourceTier): Promise<SourceRecord[]> {
  return listSources(db, { tier, enabled: true });
}

export async function createSource(db: DbClient, input: SourceCreateInput): Promise<SourceRecord> {
  const [created] = await db.insert(sources).values({
    name: input.name,
    url: input.url,
    fetcherType: input.fetcherType,
    config: input.config,
    tier: input.tier,
    category: input.category ?? null,
    enabled: input.enabled ?? true
  }).returning();

  if (!created) {
    throw new Error("Failed to create source");
  }
  return created as SourceRecord;
}

/**
 * admin_snapshot currently protects only enabled/config. For the two SMM seeds,
 * 0027_smm_quotes_sources.sql still overwrites name/fetcher_type/tier/category on every deploy;
 * an admin change immediately followed by deploy is silently lost, and tier changes affect
 * alertLevelFromTier. This is a known limitation requiring manual review. A full fix needs the
 * option-B snapshot-key expansion plus a new migration; see the Round 4 review.
 */
export async function updateSource(db: DbClient, id: number, input: SourceUpdateInput): Promise<SourceRecord | null> {
  if (input.url !== undefined || input.enabled === true) {
    const [current] = await db.select({
      url: sources.url,
      fetcherType: sources.fetcherType,
      urlLocked: sources.urlLocked,
      config: sources.config
    }).from(sources).where(eq(sources.id, id));
    if (current?.urlLocked === true && input.url !== undefined && input.url !== current.url) {
      throw new ProtectedSourceUrlError();
    }
    if (current?.urlLocked === true && input.enabled === true) {
      const logicalGroup = smmLogicalGroup(current);
      if (logicalGroup !== null) {
        const siblings = await db.select({
          id: sources.id,
          url: sources.url,
          fetcherType: sources.fetcherType,
          config: sources.config,
          enabled: sources.enabled
        }).from(sources).where(and(eq(sources.urlLocked, true), ne(sources.id, id)));
        const conflicting = siblings
          .filter((sibling) => sibling.enabled === true && smmLogicalGroup(sibling) === logicalGroup)
          .sort((left, right) => left.id - right.id)[0];
        if (conflicting) {
          throw new DuplicateEnabledSourceError(conflicting.id);
        }
      }
    }
  }

  const snapshotPatch: Record<string, unknown> = {};
  if (input.enabled !== undefined) snapshotPatch.enabled = input.enabled;
  if (input.config !== undefined) snapshotPatch.config = input.config;

  const [updated] = await db.update(sources).set({
    ...input,
    ...(Object.keys(input).length > 0 ? { adminTouchedAt: new Date() } : {}),
    ...(Object.keys(snapshotPatch).length > 0
      ? { adminSnapshot: sql`COALESCE(${sources.adminSnapshot}, '{}'::jsonb) || ${JSON.stringify(snapshotPatch)}::jsonb` }
      : {})
  }).where(eq(sources.id, id)).returning();
  return (updated as SourceRecord | undefined) ?? null;
}

export async function softDeleteSource(db: DbClient, id: number): Promise<SourceRecord | null> {
  return updateSource(db, id, { enabled: false });
}

export async function markSourceSuccess(db: DbClient, id: number, now = new Date()): Promise<void> {
  // Clear any recorded failure reason on recovery.
  await db.update(sources).set({ lastOkAt: now, failCount: 0, enabled: true, lastError: null, lastErrorAt: null }).where(eq(sources.id, id));
}

const LAST_ERROR_MAX_LEN = 1000;

export async function markSourceFailure(
  db: DbClient,
  id: number,
  failCount: number,
  disable = false,
  lastError?: string | null,
  now = new Date()
): Promise<void> {
  // lastError semantics: undefined => leave column unchanged; null => clear; string => record (truncated).
  const lastErrorValue = lastError === undefined ? undefined : lastError === null ? null : lastError.slice(0, LAST_ERROR_MAX_LEN);
  await db.update(sources).set({
    failCount,
    enabled: disable ? false : undefined,
    lastError: lastErrorValue,
    lastErrorAt: lastError === undefined ? undefined : lastError === null ? null : now
  }).where(eq(sources.id, id));
}
