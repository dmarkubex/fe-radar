import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  not,
  or,
  sql
} from "drizzle-orm";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";
import {
  clusterItems,
  clusters,
  getDb,
  itemAnalysis,
  items,
  sources
} from "@fe-radar/db";

import type { DbClient } from "@fe-radar/db";
import type { AlertQuery } from "@/lib/api/alerts-schema";
import {
  buildTimelineSourceDisplay,
  type TimelineItemDto
} from "@/lib/api/timeline-query";
import {
  BLOCKED_QUOTA_STATES,
  MANUAL_SCRUB_SUMMARY
} from "@/lib/api/item-visibility";
import { decodeCursor, encodeCursor } from "@/lib/api/cursor";
import { isMockMode } from "@/lib/mock-mode";
import { mockFetchAlertCount, mockFetchAlerts } from "@/lib/mock-data";

export interface AlertCursorRow {
  id: number;
  scoredAt: Date | null;
}

export function encodeAlertCursor(row: AlertCursorRow): string | null {
  // at = scoredAt ISO, keyset column intentionally unchanged
  return row.scoredAt
    ? encodeCursor({ at: row.scoredAt.toISOString(), id: row.id })
    : null;
}

function baseAlertConditions(
  query: Pick<AlertQuery, "type" | "level" | "source" | "cursor">,
  range: "24h" | "7d" | "all" = "24h"
) {
  const cursor = decodeCursor(query.cursor);
  const cursorAt = cursor ? dayjs(cursor.at).tz(APP_TIMEZONE).toDate() : null;
  const rangeStart =
    range === "24h"
      ? dayjs().tz(APP_TIMEZONE).subtract(24, "hour").toDate()
      : range === "7d"
        ? dayjs().tz(APP_TIMEZONE).subtract(7, "day").toDate()
        : null;
  return and(
    isNotNull(itemAnalysis.alertType),
    isNotNull(itemAnalysis.scoredAt),
    not(inArray(itemAnalysis.quotaState, [...BLOCKED_QUOTA_STATES])),
    or(
      isNull(itemAnalysis.summaryZh),
      ne(itemAnalysis.summaryZh, MANUAL_SCRUB_SUMMARY)
    ),
    or(isNull(clusters.id), eq(clusters.leadItemId, items.id)),
    query.type ? eq(itemAnalysis.alertType, query.type) : undefined,
    query.level ? eq(itemAnalysis.alertLevel, query.level) : undefined,
    query.source ? eq(sources.id, query.source) : undefined,
    rangeStart ? gte(itemAnalysis.scoredAt, rangeStart) : undefined,
    cursor && cursorAt
      ? or(
          lt(itemAnalysis.scoredAt, cursorAt),
          and(eq(itemAnalysis.scoredAt, cursorAt), lt(items.id, cursor.id))
        )
      : undefined
  );
}

export async function fetchAlerts(
  query: AlertQuery,
  db?: DbClient
): Promise<{ items: TimelineItemDto[]; nextCursor: string | null }> {
  if (isMockMode()) {
    return mockFetchAlerts(query);
  }
  db ??= getDb();
  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      url: items.url,
      sourceName: sources.name,
      sourceTier: sources.tier,
      sourceCategory: sources.category,
      sourceFetcherType: sources.fetcherType,
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
    .where(baseAlertConditions(query, query.range))
    .orderBy(desc(itemAnalysis.scoredAt), desc(items.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => {
      const display = buildTimelineSourceDisplay(row);
      return {
        id: row.id,
        title: row.title,
        url: display.url,
        displayUrl: display.displayUrl,
        sourceName: row.sourceName,
        sourceTier: row.sourceTier,
        sourceCategory: row.sourceCategory,
        sourceFetcherType: row.sourceFetcherType,
        acquisitionLabel: display.acquisitionLabel,
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
      };
    }),
    nextCursor:
      rows.length > query.limit && last ? encodeAlertCursor(last) : null
  };
}

export async function fetchAlertCount(
  range: "24h" | "7d" | "all" = "24h",
  db?: DbClient
): Promise<{
  own: number;
  safety: number;
  policy: number;
  legal: number;
  risk: number;
}> {
  if (isMockMode()) {
    return mockFetchAlertCount();
  }
  db ??= getDb();
  const rows = await db
    .select({ alertType: itemAnalysis.alertType })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .innerJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id))
    .leftJoin(clusterItems, eq(clusterItems.itemId, items.id))
    .leftJoin(clusters, eq(clusters.id, clusterItems.clusterId))
    .where(baseAlertConditions({}, range));

  const count = { own: 0, safety: 0, policy: 0, legal: 0, risk: 0 };
  for (const row of rows) {
    if (
      row.alertType === "own" ||
      row.alertType === "safety" ||
      row.alertType === "policy" ||
      row.alertType === "legal" ||
      row.alertType === "risk"
    ) {
      count[row.alertType] += 1;
    }
  }
  return count;
}
