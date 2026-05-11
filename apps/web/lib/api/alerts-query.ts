import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, not, or, sql } from "drizzle-orm";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";
import { clusterItems, clusters, getDb, itemAnalysis, items, sources } from "@fe-radar/db";

import type { DbClient } from "@fe-radar/db";
import type { AlertQuery } from "@/lib/api/alerts-schema";
import type { TimelineItemDto } from "@/lib/api/timeline-query";

const BLOCKED_QUOTA_STATES = ["pending_over_quota", "dropped_quota_expired", "dropped_filter"] as const;
const MANUAL_SCRUB_SUMMARY = "[需人工脱敏]";

interface CursorPayload {
  scoredAt: string;
  id: number;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): CursorPayload | null {
  if (!cursor) {
    return null;
  }
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorPayload>;
    return value.scoredAt && typeof value.id === "number" ? { scoredAt: value.scoredAt, id: value.id } : null;
  } catch {
    return null;
  }
}

function baseAlertConditions(query: Pick<AlertQuery, "type" | "level" | "source" | "cursor">, fromStartOfDay = false) {
  const cursor = decodeCursor(query.cursor);
  return and(
    isNotNull(itemAnalysis.alertType),
    isNotNull(itemAnalysis.scoredAt),
    not(inArray(itemAnalysis.quotaState, [...BLOCKED_QUOTA_STATES])),
    or(isNull(itemAnalysis.summaryZh), ne(itemAnalysis.summaryZh, MANUAL_SCRUB_SUMMARY)),
    or(isNull(clusters.id), eq(clusters.leadItemId, items.id)),
    query.type ? eq(itemAnalysis.alertType, query.type) : undefined,
    query.level ? eq(itemAnalysis.alertLevel, query.level) : undefined,
    query.source ? eq(sources.id, query.source) : undefined,
    fromStartOfDay ? gte(itemAnalysis.scoredAt, dayjs().tz(APP_TIMEZONE).startOf("day").toDate()) : undefined,
    cursor ? or(lt(itemAnalysis.scoredAt, new Date(cursor.scoredAt)), and(eq(itemAnalysis.scoredAt, new Date(cursor.scoredAt)), lt(items.id, cursor.id))) : undefined
  );
}

export async function fetchAlerts(query: AlertQuery, db: DbClient = getDb()): Promise<{ items: TimelineItemDto[]; nextCursor: string | null }> {
  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      url: items.url,
      sourceName: sources.name,
      sourceTier: sources.tier,
      sourceCategory: sources.category,
      publishedAt: items.publishedAt,
      scoredAt: itemAnalysis.scoredAt,
      summaryZh: itemAnalysis.summaryZh,
      category: itemAnalysis.category,
      topCircle: itemAnalysis.topCircle,
      qualityScore: itemAnalysis.qualityScore,
      alertType: itemAnalysis.alertType,
      alertLevel: itemAnalysis.alertLevel,
      clusterId: clusters.id,
      eventType: clusters.eventType,
      relatedCount: sql<number>`greatest((select count(*)::int - 1 from ${clusterItems} ci where ci.cluster_id = ${clusterItems.clusterId}), 0)`
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .innerJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id))
    .leftJoin(clusterItems, eq(clusterItems.itemId, items.id))
    .leftJoin(clusters, eq(clusters.id, clusterItems.clusterId))
    .where(baseAlertConditions(query))
    .orderBy(desc(itemAnalysis.scoredAt), desc(items.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      title: row.title,
      url: row.url,
      sourceName: row.sourceName,
      sourceTier: row.sourceTier,
      sourceCategory: row.sourceCategory,
      publishedAt: row.publishedAt.toISOString(),
      scoredAt: row.scoredAt?.toISOString() ?? null,
      summaryZh: row.summaryZh,
      category: row.category,
      topCircle: row.topCircle,
      qualityScore: row.qualityScore,
      alertType: row.alertType,
      alertLevel: row.alertLevel,
      clusterId: row.clusterId,
      eventType: row.eventType,
      relatedCount: Number(row.relatedCount ?? 0)
    })),
    nextCursor: rows.length > query.limit && last?.scoredAt ? encodeCursor({ scoredAt: last.scoredAt.toISOString(), id: last.id }) : null
  };
}

export async function fetchAlertCount(db: DbClient = getDb()): Promise<{ own: number; safety: number; policy: number }> {
  const rows = await db
    .select({ alertType: itemAnalysis.alertType })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .innerJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id))
    .leftJoin(clusterItems, eq(clusterItems.itemId, items.id))
    .leftJoin(clusters, eq(clusters.id, clusterItems.clusterId))
    .where(baseAlertConditions({}, true));

  const count = { own: 0, safety: 0, policy: 0 };
  for (const row of rows) {
    if (row.alertType === "own" || row.alertType === "safety" || row.alertType === "policy") {
      count[row.alertType] += 1;
    }
  }
  return count;
}
