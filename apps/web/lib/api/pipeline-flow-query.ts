import { asc, eq, gte } from "drizzle-orm";
import { clusterItems, getDb, itemAnalysis, itemEntities, items, sources } from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

import type { DbClient } from "@fe-radar/db";
import { isMockMode } from "@/lib/mock-mode";

export const THRESHOLD_GREEN = 0.6;

const STALE_HOURS_THRESHOLD = 12;
const FAILING_FAIL_COUNT = 3;

export type PipelineStageKey = "fetch" | "prefilter" | "ner" | "scorer" | "embedder" | "cluster" | "curator";
export type PipelineLight = "green" | "yellow" | "red" | "grey";
export type SourceTier = "T1" | "T2" | "T3";
type SourceHealthStatus = "healthy" | "stale" | "failing" | "disabled";

export const PIPELINE_STAGES: ReadonlyArray<{ key: PipelineStageKey; label: string }> = [
  { key: "fetch", label: "抓取" },
  { key: "prefilter", label: "预筛" },
  { key: "ner", label: "NER" },
  { key: "scorer", label: "评分" },
  { key: "embedder", label: "向量" },
  { key: "cluster", label: "聚簇" },
  { key: "curator", label: "精选" }
];

const STAGE_INDEX: Record<PipelineStageKey, number> = {
  fetch: 0,
  prefilter: 1,
  ner: 2,
  scorer: 3,
  embedder: 4,
  cluster: 5,
  curator: 6
};

export interface PipelineFlowSource {
  id: number;
  name: string;
  tier: SourceTier;
  perStage: Record<PipelineStageKey, PipelineLight>;
}

export interface PipelineFlowPayload {
  stages: typeof PIPELINE_STAGES;
  sources: PipelineFlowSource[];
}

export interface PipelineFlowSourceMarkerRow {
  id: number;
  name: string;
  tier: string;
  enabled: boolean;
  lastOkAt: Date | null;
  failCount: number;
}

export interface PipelineFlowItemMarkerRow {
  id: number;
  sourceId: number;
  isIndustryRelated: boolean | null;
  d1Policy: number | null;
  embedding: unknown | null;
  scoredAt: Date | null;
  isCurated?: boolean | null;
}

interface StageCounters {
  totalItems: number;
  prefilterDone: number;
  downstreamEligible: number;
  nerDone: number;
  scorerDone: number;
  embedderDone: number;
  clusterDone: number;
  curatorDone: number;
}

function emptyCounters(): StageCounters {
  return {
    totalItems: 0,
    prefilterDone: 0,
    downstreamEligible: 0,
    nerDone: 0,
    scorerDone: 0,
    embedderDone: 0,
    clusterDone: 0,
    curatorDone: 0
  };
}

function computeSourceHealth(enabled: boolean, failCount: number, lastOkAt: Date | null): SourceHealthStatus {
  if (!enabled) return "disabled";
  if (failCount >= FAILING_FAIL_COUNT) return "failing";
  if (lastOkAt === null) return "stale";
  const hours = dayjs().tz(APP_TIMEZONE).diff(dayjs(lastOkAt).tz(APP_TIMEZONE), "hour", true);
  if (hours > STALE_HOURS_THRESHOLD) return "stale";
  return "healthy";
}

function fetchLight(source: PipelineFlowSourceMarkerRow): PipelineLight {
  const health = computeSourceHealth(source.enabled, source.failCount, source.lastOkAt);
  if (health === "disabled") return "grey";
  if (health === "failing") return "red";
  if (health === "stale") return "yellow";
  return "green";
}

function ratioLight(done: number, total: number): PipelineLight {
  if (total === 0) return "grey";
  if (done === 0) return "red";
  return done / total >= THRESHOLD_GREEN ? "green" : "yellow";
}

function reachedStageIndex(
  item: PipelineFlowItemMarkerRow,
  entityItemIds: ReadonlySet<number>,
  clusterItemIds: ReadonlySet<number>
): number {
  let reached = -1;
  if (item.isIndustryRelated !== null) reached = Math.max(reached, STAGE_INDEX.prefilter);
  if (item.d1Policy !== null || entityItemIds.has(item.id)) reached = Math.max(reached, STAGE_INDEX.ner);
  if (item.d1Policy !== null) reached = Math.max(reached, STAGE_INDEX.scorer);
  if (item.embedding !== null) reached = Math.max(reached, STAGE_INDEX.embedder);
  if (clusterItemIds.has(item.id)) reached = Math.max(reached, STAGE_INDEX.cluster);
  if (item.scoredAt !== null) reached = Math.max(reached, STAGE_INDEX.curator);
  return reached;
}

function buildCountersBySource(
  itemRows: readonly PipelineFlowItemMarkerRow[],
  entityItemIds: ReadonlySet<number>,
  clusterItemIds: ReadonlySet<number>
): Map<number, StageCounters> {
  const countersBySource = new Map<number, StageCounters>();

  for (const item of itemRows) {
    const counters = countersBySource.get(item.sourceId) ?? emptyCounters();
    countersBySource.set(item.sourceId, counters);
    counters.totalItems += 1;

    const reached = reachedStageIndex(item, entityItemIds, clusterItemIds);
    if (reached >= STAGE_INDEX.prefilter) {
      counters.prefilterDone += 1;
    }

    if (item.isIndustryRelated !== true) {
      continue;
    }

    counters.downstreamEligible += 1;
    if (reached >= STAGE_INDEX.ner) counters.nerDone += 1;
    if (reached >= STAGE_INDEX.scorer) counters.scorerDone += 1;
    if (reached >= STAGE_INDEX.embedder) counters.embedderDone += 1;
    if (reached >= STAGE_INDEX.cluster) counters.clusterDone += 1;
    if (reached >= STAGE_INDEX.curator) counters.curatorDone += 1;
  }

  return countersBySource;
}

function buildPerStage(source: PipelineFlowSourceMarkerRow, counters: StageCounters): Record<PipelineStageKey, PipelineLight> {
  if (!source.enabled) {
    return {
      fetch: "grey",
      prefilter: "grey",
      ner: "grey",
      scorer: "grey",
      embedder: "grey",
      cluster: "grey",
      curator: "grey"
    };
  }

  return {
    fetch: fetchLight(source),
    prefilter: ratioLight(counters.prefilterDone, counters.totalItems),
    ner: ratioLight(counters.nerDone, counters.downstreamEligible),
    scorer: ratioLight(counters.scorerDone, counters.downstreamEligible),
    embedder: ratioLight(counters.embedderDone, counters.downstreamEligible),
    cluster: ratioLight(counters.clusterDone, counters.downstreamEligible),
    curator: ratioLight(counters.curatorDone, counters.downstreamEligible)
  };
}

export function buildPipelineFlowPayload(
  sourceRows: readonly PipelineFlowSourceMarkerRow[],
  itemRows: readonly PipelineFlowItemMarkerRow[],
  entityItemIdsInput: Iterable<number>,
  clusterItemIdsInput: Iterable<number>
): PipelineFlowPayload {
  const entityItemIds = entityItemIdsInput instanceof Set ? entityItemIdsInput : new Set(entityItemIdsInput);
  const clusterItemIds = clusterItemIdsInput instanceof Set ? clusterItemIdsInput : new Set(clusterItemIdsInput);
  const countersBySource = buildCountersBySource(itemRows, entityItemIds, clusterItemIds);

  return {
    stages: PIPELINE_STAGES,
    sources: sourceRows.map((source) => {
      const counters = countersBySource.get(source.id) ?? emptyCounters();
      return {
        id: source.id,
        name: source.name,
        tier: source.tier as SourceTier,
        perStage: buildPerStage(source, counters)
      };
    })
  };
}

function mockPipelineFlow(): PipelineFlowPayload {
  const now = dayjs().tz(APP_TIMEZONE).toDate();
  const sourcesMock: PipelineFlowSourceMarkerRow[] = [
    { id: 1, name: "北极星储能网", tier: "T1", enabled: true, lastOkAt: now, failCount: 0 },
    { id: 2, name: "中国能源报", tier: "T2", enabled: true, lastOkAt: now, failCount: 0 },
    { id: 3, name: "上海有色网 SMM", tier: "T2", enabled: true, lastOkAt: dayjs().tz(APP_TIMEZONE).subtract(15, "hour").toDate(), failCount: 1 },
    { id: 4, name: "国家能源局", tier: "T1", enabled: true, lastOkAt: dayjs().tz(APP_TIMEZONE).subtract(20, "hour").toDate(), failCount: 5 },
    { id: 5, name: "工信部停用源", tier: "T2", enabled: false, lastOkAt: null, failCount: 0 }
  ];
  const itemsMock: PipelineFlowItemMarkerRow[] = [
    { id: 101, sourceId: 1, isIndustryRelated: true, d1Policy: 0.8, embedding: [0.1], scoredAt: now },
    { id: 102, sourceId: 1, isIndustryRelated: true, d1Policy: 0.7, embedding: [0.2], scoredAt: now },
    { id: 103, sourceId: 1, isIndustryRelated: false, d1Policy: null, embedding: null, scoredAt: null },
    { id: 201, sourceId: 2, isIndustryRelated: true, d1Policy: 0.5, embedding: null, scoredAt: null },
    { id: 202, sourceId: 2, isIndustryRelated: false, d1Policy: null, embedding: null, scoredAt: null },
    { id: 301, sourceId: 3, isIndustryRelated: null, d1Policy: null, embedding: null, scoredAt: null }
  ];

  return buildPipelineFlowPayload(sourcesMock, itemsMock, [101, 102, 201], [101, 102]);
}

export async function fetchPipelineFlow(db?: DbClient): Promise<PipelineFlowPayload> {
  if (isMockMode()) {
    return mockPipelineFlow();
  }

  db ??= getDb();
  const cutoff = dayjs().tz(APP_TIMEZONE).subtract(24, "hour").toDate();

  const [sourceRows, itemRows, entityRows, clusterRows] = await Promise.all([
    db
      .select({
        id: sources.id,
        name: sources.name,
        tier: sources.tier,
        enabled: sources.enabled,
        lastOkAt: sources.lastOkAt,
        failCount: sources.failCount
      })
      .from(sources)
      .orderBy(asc(sources.id)),
    db
      .select({
        id: items.id,
        sourceId: items.sourceId,
        isIndustryRelated: itemAnalysis.isIndustryRelated,
        d1Policy: itemAnalysis.d1Policy,
        embedding: itemAnalysis.embedding,
        scoredAt: itemAnalysis.scoredAt
      })
      .from(items)
      .leftJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id))
      .where(gte(items.fetchedAt, cutoff)),
    db
      .select({ itemId: itemEntities.itemId })
      .from(itemEntities)
      .innerJoin(items, eq(items.id, itemEntities.itemId))
      .where(gte(items.fetchedAt, cutoff)),
    db
      .select({ itemId: clusterItems.itemId })
      .from(clusterItems)
      .innerJoin(items, eq(items.id, clusterItems.itemId))
      .where(gte(items.fetchedAt, cutoff))
  ]);

  return buildPipelineFlowPayload(
    sourceRows,
    itemRows,
    entityRows.map((row) => row.itemId),
    clusterRows.map((row) => row.itemId)
  );
}
