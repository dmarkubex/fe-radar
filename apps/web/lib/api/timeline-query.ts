import { and, desc, eq, ilike, inArray, isNotNull, isNull, lt, ne, not, or, sql } from "drizzle-orm";
import {
  clusterItems,
  clusters,
  entities,
  getDb,
  itemAnalysis,
  itemEntities,
  items,
  sources
} from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

import type { DbClient } from "@fe-radar/db";
import type { TimelineFilters } from "@/lib/api/timeline-schema";
import { BLOCKED_QUOTA_STATES, MANUAL_SCRUB_SUMMARY } from "@/lib/api/item-visibility";
import { decodeCursor, encodeCursor } from "@/lib/api/cursor";
import { isMockMode } from "@/lib/mock-mode";
import { mockFetchItemDetail, mockFetchTimeline } from "@/lib/mock-data";

const DEFAULT_LIMIT = 50;

export type TimelineKeysetAxis = "publishedAt" | "scoredAt";

export interface TimelinePaginationPlan {
  orderBy: "publishedAt" | "qualityScore";
  keysetAxis: TimelineKeysetAxis;
}

export interface TimelineItemDto {
  id: number;
  title: string;
  url: string;
  sourceName: string;
  sourceTier: string;
  sourceCategory: string | null;
  publishedAt: string;
  scoredAt: string | null;
  summaryZh: string | null;
  category: string | null;
  topCircle: string | null;
  qualityScore: number | null;
  alertType: string | null;
  alertLevel: string | null;
  clusterId: number | null;
  eventType: string | null;
  relatedCount: number;
}

export interface TimelineResult {
  items: TimelineItemDto[];
  nextCursor: string | null;
}

export interface TimelineCursorRow {
  id: number;
  publishedAt: Date;
  scoredAt: Date | null;
}

export interface ItemDetailDto extends TimelineItemDto {
  content: string | null;
  translationZh: string | null;
  scores: {
    d1Policy: number | null;
    d2Chain: number | null;
    d3Market: number | null;
    d4Tech: number | null;
    d5Business: number | null;
  };
  entities: Array<{
    id: number;
    type: string;
    canonicalName: string;
    circle: string | null;
    span: string | null;
  }>;
  clusterItems: Array<{
    id: number;
    title: string;
    url: string;
    sourceName: string;
    publishedAt: string;
    similarity: number | null;
  }>;
}

export function resolveTimelinePaginationPlan(filters: Pick<TimelineFilters, "curated"> = {}): TimelinePaginationPlan {
  return filters.curated ? { orderBy: "qualityScore", keysetAxis: "scoredAt" } : { orderBy: "publishedAt", keysetAxis: "publishedAt" };
}

export function encodeTimelineCursor(row: TimelineCursorRow, axis: TimelineKeysetAxis): string | null {
  const at = axis === "publishedAt" ? row.publishedAt : row.scoredAt;
  return at ? encodeCursor({ at: at.toISOString(), id: row.id }) : null;
}

function visibleItemConditions(filters: TimelineFilters, includeBlocked: boolean, cursor?: string, search?: string, useFts = true) {
  const conditions = [
    isNotNull(itemAnalysis.scoredAt),
    includeBlocked ? undefined : not(inArray(itemAnalysis.quotaState, [...BLOCKED_QUOTA_STATES])),
    includeBlocked ? undefined : or(isNull(itemAnalysis.summaryZh), ne(itemAnalysis.summaryZh, MANUAL_SCRUB_SUMMARY)),
    or(isNull(clusters.id), eq(clusters.leadItemId, items.id)),
    filters.category ? eq(itemAnalysis.category, filters.category) : undefined,
    filters.circle ? eq(itemAnalysis.topCircle, filters.circle) : undefined,
    filters.tier ? eq(sources.tier, filters.tier) : undefined,
    filters.eventType ? eq(clusters.eventType, filters.eventType) : undefined,
    filters.alertType ? eq(itemAnalysis.alertType, filters.alertType) : undefined,
    filters.curated ? eq(itemAnalysis.isCurated, true) : undefined
  ].filter(Boolean);

  const parsedCursor = decodeCursor(cursor);
  if (parsedCursor) {
    const plan = resolveTimelinePaginationPlan(filters);
    const at = dayjs(parsedCursor.at).tz(APP_TIMEZONE).toDate();
    conditions.push(
      plan.keysetAxis === "publishedAt"
        ? or(lt(items.publishedAt, at), and(eq(items.publishedAt, at), lt(items.id, parsedCursor.id)))
        : or(lt(itemAnalysis.scoredAt, at), and(eq(itemAnalysis.scoredAt, at), lt(items.id, parsedCursor.id)))
    );
  }

  if (search) {
    const keyword = `%${search}%`;
    conditions.push(
      useFts ? or(
        ilike(items.title, keyword),
        ilike(items.content, keyword),
        ilike(itemAnalysis.summaryZh, keyword),
        sql<boolean>`to_tsvector('zhparser', coalesce(${items.title}, '') || ' ' || coalesce(${items.content}, '') || ' ' || coalesce(${itemAnalysis.summaryZh}, '')) @@ plainto_tsquery('zhparser', ${search})`
      ) : or(ilike(items.title, keyword), ilike(items.content, keyword), ilike(itemAnalysis.summaryZh, keyword))
    );
  }

  return and(...conditions);
}

function toTimelineItem(row: Awaited<ReturnType<typeof fetchRows>>[number]): TimelineItemDto {
  return {
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
  };
}

async function fetchRows(
  db: DbClient,
  options: {
    filters: TimelineFilters;
    includeBlocked: boolean;
    cursor?: string;
    limit?: number;
    search?: string;
    curatedOrder?: boolean;
    useFts?: boolean;
  }
) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const plan = resolveTimelinePaginationPlan({ curated: options.curatedOrder });
  return db
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
    .where(visibleItemConditions(options.filters, options.includeBlocked, options.cursor, options.search, options.useFts))
    .orderBy(plan.orderBy === "qualityScore" ? desc(itemAnalysis.qualityScore) : desc(items.publishedAt), desc(items.id))
    .limit(limit + 1);
}

export async function fetchTimeline(options: {
  filters?: TimelineFilters;
  includeBlocked?: boolean;
  cursor?: string;
  limit?: number;
  search?: string;
  db?: DbClient;
}): Promise<TimelineResult> {
  if (isMockMode()) {
    return mockFetchTimeline(options);
  }
  const db = options.db ?? getDb();
  const filters = options.filters ?? {};
  const limit = options.limit ?? DEFAULT_LIMIT;
  let rows: Awaited<ReturnType<typeof fetchRows>>;
  try {
    rows = await fetchRows(db, {
      filters,
      includeBlocked: options.includeBlocked ?? false,
      cursor: options.cursor,
      limit,
      search: options.search,
      curatedOrder: filters.curated,
      useFts: true
    });
  } catch (error) {
    if (!options.search) {
      throw error;
    }
    rows = await fetchRows(db, {
      filters,
      includeBlocked: options.includeBlocked ?? false,
      cursor: options.cursor,
      limit,
      search: options.search,
      curatedOrder: filters.curated,
      useFts: false
    });
  }

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const plan = resolveTimelinePaginationPlan(filters);
  let nextCursor: string | null = null;
  if (rows.length > limit && last) {
    if (plan.keysetAxis === "scoredAt") {
      // at = scoredAt ISO, keyset column intentionally unchanged
      nextCursor = encodeTimelineCursor(last, "scoredAt");
    } else {
      nextCursor = encodeTimelineCursor(last, "publishedAt");
    }
  }
  return {
    items: page.map(toTimelineItem),
    nextCursor
  };
}

export async function fetchItemDetail(
  id: number,
  options: { includeBlocked?: boolean; db?: DbClient } = {}
): Promise<ItemDetailDto | null> {
  if (isMockMode()) {
    return mockFetchItemDetail(id);
  }
  const db = options.db ?? getDb();
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
      relatedCount: sql<number>`greatest((select count(*)::int - 1 from ${clusterItems} ci where ci.cluster_id = ${clusterItems.clusterId}), 0)`,
      content: items.content,
      translationZh: itemAnalysis.translationZh,
      d1Policy: itemAnalysis.d1Policy,
      d2Chain: itemAnalysis.d2Chain,
      d3Market: itemAnalysis.d3Market,
      d4Tech: itemAnalysis.d4Tech,
      d5Business: itemAnalysis.d5Business
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .innerJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id))
    .leftJoin(clusterItems, eq(clusterItems.itemId, items.id))
    .leftJoin(clusters, eq(clusters.id, clusterItems.clusterId))
    .where(and(eq(items.id, id), visibleItemConditions({}, options.includeBlocked ?? false)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  const [entityRows, clusterRows] = await Promise.all([
    db
      .select({
        id: entities.id,
        type: entities.type,
        canonicalName: entities.canonicalName,
        circle: entities.circle,
        span: itemEntities.span
      })
      .from(itemEntities)
      .innerJoin(entities, eq(entities.id, itemEntities.entityId))
      .where(eq(itemEntities.itemId, id)),
    row.clusterId
      ? db
          .select({
            id: items.id,
            title: items.title,
            url: items.url,
            sourceName: sources.name,
            publishedAt: items.publishedAt,
            similarity: clusterItems.similarity
          })
          .from(clusterItems)
          .innerJoin(items, eq(items.id, clusterItems.itemId))
          .innerJoin(sources, eq(sources.id, items.sourceId))
          .where(eq(clusterItems.clusterId, row.clusterId))
      : Promise.resolve([])
  ]);

  return {
    ...toTimelineItem(row),
    content: row.content,
    translationZh: row.translationZh,
    scores: {
      d1Policy: row.d1Policy,
      d2Chain: row.d2Chain,
      d3Market: row.d3Market,
      d4Tech: row.d4Tech,
      d5Business: row.d5Business
    },
    entities: entityRows,
    clusterItems: clusterRows.map((item) => ({
      ...item,
      publishedAt: item.publishedAt.toISOString()
    }))
  };
}
