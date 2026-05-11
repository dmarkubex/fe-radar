import { and, eq, type SQL } from "drizzle-orm";
import type { DbClient } from "../client";
import { sources } from "../schema";

export type SourceTier = "T1" | "T2" | "T3";
export type FetcherType = "rss" | "html" | "playwright";

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

export async function updateSource(db: DbClient, id: number, input: SourceUpdateInput): Promise<SourceRecord | null> {
  const [updated] = await db.update(sources).set(input).where(eq(sources.id, id)).returning();
  return (updated as SourceRecord | undefined) ?? null;
}

export async function softDeleteSource(db: DbClient, id: number): Promise<SourceRecord | null> {
  return updateSource(db, id, { enabled: false });
}

export async function markSourceSuccess(db: DbClient, id: number, now = new Date()): Promise<void> {
  await db.update(sources).set({ lastOkAt: now, failCount: 0, enabled: true }).where(eq(sources.id, id));
}

export async function markSourceFailure(db: DbClient, id: number, failCount: number, disable = false): Promise<void> {
  await db.update(sources).set({ failCount, enabled: disable ? false : undefined }).where(eq(sources.id, id));
}
