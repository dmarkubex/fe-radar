import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbClient } from "../client";
import { entityFinancials } from "../schema";

export interface EntityFinancialRecord {
  id: number;
  entityId: number;
  metric: string;
  value: number | null;
  period: string;
  observedAt: Date | null;
  fetchedAt: Date;
}

export interface EntityFinancialInsert {
  entityId: number;
  metric: string;
  value: number | null;
  period: string;
  observedAt: Date | null;
}

/**
 * 批量 upsert 财务指标。
 * ON CONFLICT (entity_id, metric, period) DO UPDATE — 覆盖 value / observed_at / fetched_at。
 * 返回实际写入行数。
 */
export async function upsertEntityFinancials(
  db: DbClient,
  records: EntityFinancialInsert[]
): Promise<number> {
  if (records.length === 0) return 0;

  // R2-1: 批内去重 — 同一 (entityId, metric, period) 只保留最后一条，
  // 否则 Postgres INSERT...ON CONFLICT DO UPDATE 报
  // "cannot affect row a second time" 整批崩溃。
  const dedupMap = new Map<string, EntityFinancialInsert>();
  for (const record of records) {
    const key = `${record.entityId}|${record.metric}|${record.period}`;
    dedupMap.set(key, record);
  }
  const values = Array.from(dedupMap.values()).map((record) => ({
    entityId: record.entityId,
    metric: record.metric,
    value: record.value !== null ? String(record.value) : null,
    period: record.period,
    observedAt: record.observedAt
  }));

  await db
    .insert(entityFinancials)
    .values(values)
    .onConflictDoUpdate({
      target: [entityFinancials.entityId, entityFinancials.metric, entityFinancials.period],
      set: {
        value: sql`EXCLUDED.value`,
        observedAt: sql`EXCLUDED.observed_at`,
        fetchedAt: sql`now()`
      }
    });

  return records.length;
}

/**
 * 查询某 entity 的全部财务指标，按 observed_at DESC 排序。
 */
export async function listEntityFinancials(
  db: DbClient,
  entityId: number,
  limit = 100
): Promise<EntityFinancialRecord[]> {
  const rows = await db
    .select({
      id: entityFinancials.id,
      entityId: entityFinancials.entityId,
      metric: entityFinancials.metric,
      value: entityFinancials.value,
      period: entityFinancials.period,
      observedAt: entityFinancials.observedAt,
      fetchedAt: entityFinancials.fetchedAt
    })
    .from(entityFinancials)
    .where(eq(entityFinancials.entityId, entityId))
    .orderBy(desc(entityFinancials.observedAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    value: r.value !== null ? Number(r.value) : null
  }));
}

/**
 * 查询指定 entity 的多个 metric 各自最新一期。
 * 用于 computeD3Market 取 ROE / 营收增速 / 净利润增速。
 */
export async function listLatestFinancialsByMetric(
  db: DbClient,
  entityId: number,
  metrics: string[]
): Promise<EntityFinancialRecord[]> {
  if (metrics.length === 0) return [];

  const rows = await db
    .select({
      id: entityFinancials.id,
      entityId: entityFinancials.entityId,
      metric: entityFinancials.metric,
      value: entityFinancials.value,
      period: entityFinancials.period,
      observedAt: entityFinancials.observedAt,
      fetchedAt: entityFinancials.fetchedAt
    })
    .from(entityFinancials)
    .where(
      and(
        eq(entityFinancials.entityId, entityId),
        inArray(entityFinancials.metric, metrics)
      )
    )
    .orderBy(desc(entityFinancials.observedAt));

  // 每个 metric 只保留最新一期（observed_at DESC 排序后去重）
  const seen = new Set<string>();
  const latest: EntityFinancialRecord[] = [];
  for (const row of rows) {
    const metricKey = row.metric.toLowerCase();
    if (seen.has(metricKey)) continue;
    seen.add(metricKey);
    latest.push({
      ...row,
      value: row.value !== null ? Number(row.value) : null
    });
  }
  return latest;
}
