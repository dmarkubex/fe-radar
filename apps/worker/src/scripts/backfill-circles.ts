import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createDbClient,
  entities,
  itemAnalysis,
  itemEntities,
  items,
  scoringConfig,
  sources
} from "@fe-radar/db";
import {
  computeD2Chain,
  computeQualityScore,
  type EntityHit,
  type ScoringConfig
} from "@fe-radar/core";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import {
  EntityDictionary,
  type EntityDictionaryEntry
} from "../lib/entities-dict";

const READ_BATCH_SIZE = 500;
const WRITE_BATCH_SIZE = 500;
const REQUIRED_SCORING_KEYS = ["weights", "t_coef", "c_coef"] as const;

type Circle = "C1" | "C2" | "C3";
type Tier = "T1" | "T2" | "T3";

export interface CircleLink {
  itemId: number;
  entityId: number;
  span: string;
  entity: EntityHit;
}

export interface AnalysisInput {
  itemId: number;
  tier: Tier;
  currentTopCircle: string | null;
  currentQualityScore: number | null;
  d1Policy: number | null;
  d2Chain: number | null;
  d3Market: number | null;
  d4Tech: number | null;
  d5Business: number | null;
}

export interface AnalysisUpdate {
  itemId: number;
  topCircle: Circle;
  d2Chain: number;
  qualityScore: number;
}

export interface BackfillPlan {
  links: CircleLink[];
  updates: AnalysisUpdate[];
}

export interface BackfillWriter {
  insertLinks(links: CircleLink[]): Promise<number>;
  updateAnalyses(updates: AnalysisUpdate[]): Promise<void>;
}

export interface CircleDistribution {
  C1: number;
  C2: number;
  C3: number;
  null: number;
}

export interface BackfillStats {
  dryRun: boolean;
  scannedItems: number;
  matchedItems: number;
  linksToCreate: number;
  linksCreated: number;
  topCircleChanges: number;
  qualityScoreChanges: number;
  before: CircleDistribution;
  after: CircleDistribution;
}

function batches<T>(values: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size)
  );
}

function linkKey(itemId: number, entityId: number): string {
  return `${itemId}:${entityId}`;
}

export function findCircleLinks(
  rows: readonly { id: number; title: string; content: string | null }[],
  dictionary: EntityDictionary
): CircleLink[] {
  let links: CircleLink[] = [];
  for (const row of rows) {
    const hits = dictionary.match(`${row.title}\n${row.content ?? ""}`);
    links = links.concat(
      hits.map((hit) => ({
        itemId: row.id,
        entityId: hit.id,
        span: hit.span,
        entity: {
          id: hit.id,
          type: hit.type,
          canonicalName: hit.canonicalName,
          circle: hit.circle
        }
      }))
    );
  }
  return links;
}

export function selectNewLinks(
  matchedLinks: readonly CircleLink[],
  existingLinks: ReadonlySet<string>
): CircleLink[] {
  const seen = new Set(existingLinks);
  let result: CircleLink[] = [];
  for (const link of matchedLinks) {
    const key = linkKey(link.itemId, link.entityId);
    if (seen.has(key)) continue;
    seen.add(key);
    result = result.concat(link);
  }
  return result;
}

export function planAnalysisUpdate(
  analysis: AnalysisInput,
  entityHits: readonly EntityHit[],
  config: ScoringConfig
): AnalysisUpdate | null {
  const entitiesForScoring = [...entityHits];
  const d2Chain = computeD2Chain(entitiesForScoring);
  const score = computeQualityScore(
    {
      d1Policy: analysis.d1Policy ?? 0,
      d2Chain,
      d3Market: analysis.d3Market ?? 0,
      d4Tech: analysis.d4Tech ?? 0,
      d5Business: analysis.d5Business ?? 0
    },
    { tier: analysis.tier },
    entitiesForScoring,
    config
  );
  if (
    score.topCircle === analysis.currentTopCircle &&
    !scoreChanged(analysis.d2Chain, d2Chain) &&
    !scoreChanged(analysis.currentQualityScore, score.qualityScore)
  ) {
    return null;
  }

  return {
    itemId: analysis.itemId,
    topCircle: score.topCircle,
    d2Chain,
    qualityScore: score.qualityScore
  };
}

export async function applyBackfillPlan(
  plan: BackfillPlan,
  dryRun: boolean,
  writer: BackfillWriter
): Promise<{ linksCreated: number }> {
  if (dryRun) return { linksCreated: 0 };
  const linksCreated = await writer.insertLinks(plan.links);
  await writer.updateAnalyses(plan.updates);
  return { linksCreated };
}

function requireNumberMap(
  value: unknown,
  rowKey: string,
  fields: readonly string[]
): Record<string, number> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`scoring_config.${rowKey} 不是对象，已中止且未写库`);
  }
  const record = value as Record<string, unknown>;
  for (const field of fields) {
    if (typeof record[field] !== "number" || !Number.isFinite(record[field])) {
      throw new Error(
        `scoring_config.${rowKey}.${field} 缺失或不是有限数字，已中止且未写库`
      );
    }
  }
  return record as Record<string, number>;
}

export function parseScoringConfig(
  rows: readonly { key: string; value: unknown }[]
): ScoringConfig {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const missing = REQUIRED_SCORING_KEYS.filter((key) => !byKey.has(key));
  if (missing.length > 0) {
    throw new Error(
      `scoring_config 缺少 ${missing.join(", ")}，已中止且未写库`
    );
  }
  return {
    weights: requireNumberMap(byKey.get("weights"), "weights", [
      "w1",
      "w2",
      "w3",
      "w4",
      "w5"
    ]) as ScoringConfig["weights"],
    tCoef: requireNumberMap(byKey.get("t_coef"), "t_coef", [
      "T1",
      "T2",
      "T3"
    ]) as ScoringConfig["tCoef"],
    cCoef: requireNumberMap(byKey.get("c_coef"), "c_coef", [
      "C1",
      "C2",
      "C3"
    ]) as ScoringConfig["cCoef"]
  };
}

function emptyDistribution(): CircleDistribution {
  return { C1: 0, C2: 0, C3: 0, null: 0 };
}

function normalizeDistribution(
  rows: readonly { topCircle: string | null; count: number }[]
): CircleDistribution {
  const result = emptyDistribution();
  for (const row of rows) {
    if (
      row.topCircle === "C1" ||
      row.topCircle === "C2" ||
      row.topCircle === "C3"
    ) {
      result[row.topCircle] = row.count;
    } else if (row.topCircle == null) {
      result.null = row.count;
    }
  }
  return result;
}

function projectedDistribution(
  before: CircleDistribution,
  analyses: ReadonlyMap<number, AnalysisInput>,
  updates: readonly AnalysisUpdate[]
): CircleDistribution {
  const after = { ...before };
  for (const update of updates) {
    const previous = analyses.get(update.itemId)?.currentTopCircle;
    if (previous === "C1" || previous === "C2" || previous === "C3") {
      after[previous] -= 1;
    } else {
      after.null -= 1;
    }
    after[update.topCircle] += 1;
  }
  return after;
}

function isTier(value: string): value is Tier {
  return value === "T1" || value === "T2" || value === "T3";
}

function scoreChanged(before: number | null, after: number): boolean {
  return before == null || Math.fround(before) !== Math.fround(after);
}

export async function runBackfillCircles(
  options: { dryRun?: boolean } = {}
): Promise<BackfillStats> {
  const dryRun = options.dryRun ?? false;
  const db = createDbClient({ runtime: "worker" });

  return db.transaction(async (tx) => {
    const dictionaryRows = await tx
      .select({
        id: entities.id,
        type: entities.type,
        canonicalName: entities.canonicalName,
        aliases: entities.aliases,
        circle: entities.circle
      })
      .from(entities)
      .where(
        and(
          eq(entities.type, "company"),
          inArray(entities.circle, ["C1", "C2"])
        )
      );

    if (dictionaryRows.length === 0) {
      throw new Error(
        "entities 中没有 C1/C2 实体，请先应用 0045_seed_circle_entities.sql"
      );
    }

    const dictionaryEntries: EntityDictionaryEntry[] = dictionaryRows.map(
      (row) => ({
        id: row.id,
        type: row.type,
        canonicalName: row.canonicalName,
        aliases: row.aliases ?? [],
        circle: row.circle as "C1" | "C2"
      })
    );
    const dictionary = new EntityDictionary(dictionaryEntries);
    const configRows = await tx
      .select({ key: scoringConfig.key, value: scoringConfig.value })
      .from(scoringConfig)
      .where(inArray(scoringConfig.key, [...REQUIRED_SCORING_KEYS]));
    const config = parseScoringConfig(configRows);

    let scannedItems = 0;
    let cursor = 0;
    let matchedLinks: CircleLink[] = [];
    for (;;) {
      const itemRows = await tx
        .select({
          id: items.id,
          title: items.title,
          content: items.content
        })
        .from(items)
        .where(gt(items.id, cursor))
        .orderBy(asc(items.id))
        .limit(READ_BATCH_SIZE);
      if (itemRows.length === 0) break;
      scannedItems += itemRows.length;
      matchedLinks = matchedLinks.concat(findCircleLinks(itemRows, dictionary));
      cursor = itemRows[itemRows.length - 1]!.id;
    }

    const existingCircleLinks = await tx
      .selectDistinct({ itemId: itemEntities.itemId })
      .from(itemEntities)
      .innerJoin(entities, eq(entities.id, itemEntities.entityId))
      .where(inArray(entities.circle, ["C1", "C2"]));
    const affectedItemIds = [
      ...new Set(
        matchedLinks
          .map((link) => link.itemId)
          .concat(existingCircleLinks.map((row) => row.itemId))
      )
    ];

    const entityHitsByItem = new Map<number, Map<number, EntityHit>>();
    const existingLinkKeys = new Set<string>();
    for (const itemIdBatch of batches(affectedItemIds, READ_BATCH_SIZE)) {
      const linkedRows = await tx
        .select({
          itemId: itemEntities.itemId,
          entityId: entities.id,
          type: entities.type,
          canonicalName: entities.canonicalName,
          circle: entities.circle
        })
        .from(itemEntities)
        .innerJoin(entities, eq(entities.id, itemEntities.entityId))
        .where(inArray(itemEntities.itemId, itemIdBatch));
      for (const row of linkedRows) {
        existingLinkKeys.add(linkKey(row.itemId, row.entityId));
        const hits = entityHitsByItem.get(row.itemId) ?? new Map();
        hits.set(row.entityId, {
          id: row.entityId,
          type: row.type,
          canonicalName: row.canonicalName,
          circle: row.circle as Circle | null
        });
        entityHitsByItem.set(row.itemId, hits);
      }
    }

    const links = selectNewLinks(matchedLinks, existingLinkKeys);
    for (const link of links) {
      const hits = entityHitsByItem.get(link.itemId) ?? new Map();
      hits.set(link.entityId, link.entity);
      entityHitsByItem.set(link.itemId, hits);
    }

    const analyses = new Map<number, AnalysisInput>();
    for (const itemIdBatch of batches(affectedItemIds, READ_BATCH_SIZE)) {
      const analysisRows = await tx
        .select({
          itemId: itemAnalysis.itemId,
          tier: sources.tier,
          currentTopCircle: itemAnalysis.topCircle,
          currentQualityScore: itemAnalysis.qualityScore,
          d1Policy: itemAnalysis.d1Policy,
          d2Chain: itemAnalysis.d2Chain,
          d3Market: itemAnalysis.d3Market,
          d4Tech: itemAnalysis.d4Tech,
          d5Business: itemAnalysis.d5Business
        })
        .from(itemAnalysis)
        .innerJoin(items, eq(items.id, itemAnalysis.itemId))
        .innerJoin(sources, eq(sources.id, items.sourceId))
        .where(inArray(itemAnalysis.itemId, itemIdBatch));
      for (const row of analysisRows) {
        if (!isTier(row.tier)) {
          throw new Error(
            `source tier=${row.tier} 非 T1/T2/T3，已中止且未写库`
          );
        }
        analyses.set(row.itemId, { ...row, tier: row.tier });
      }
    }

    let updates: AnalysisUpdate[] = [];
    for (const analysis of analyses.values()) {
      const update = planAnalysisUpdate(
        analysis,
        [...(entityHitsByItem.get(analysis.itemId)?.values() ?? [])],
        config
      );
      if (update) updates = updates.concat(update);
    }

    const before = normalizeDistribution(
      await tx
        .select({
          topCircle: itemAnalysis.topCircle,
          count: sql<number>`count(*)::int`
        })
        .from(itemAnalysis)
        .groupBy(itemAnalysis.topCircle)
    );

    const writer: BackfillWriter = {
      async insertLinks(values) {
        let inserted = 0;
        for (const valueBatch of batches(values, WRITE_BATCH_SIZE)) {
          const rows = await tx
            .insert(itemEntities)
            .values(
              valueBatch.map((value) => ({
                itemId: value.itemId,
                entityId: value.entityId,
                span: value.span
              }))
            )
            .onConflictDoNothing()
            .returning({
              itemId: itemEntities.itemId,
              entityId: itemEntities.entityId
            });
          inserted += rows.length;
        }
        return inserted;
      },
      async updateAnalyses(values) {
        for (const valueBatch of batches(values, WRITE_BATCH_SIZE)) {
          const valueRows = sql.join(
            valueBatch.map(
              (value) =>
                sql`(${value.itemId}::bigint, ${value.topCircle}::text, ${value.d2Chain}::real, ${value.qualityScore}::real)`
            ),
            sql`, `
          );
          await tx.execute(sql`
            UPDATE item_analysis AS analysis
            SET top_circle = changed.top_circle,
                d2_chain = changed.d2_chain,
                quality_score = changed.quality_score
            FROM (VALUES ${valueRows}) AS changed(item_id, top_circle, d2_chain, quality_score)
            WHERE analysis.item_id = changed.item_id
          `);
        }
      }
    };

    const writeResult = await applyBackfillPlan(
      { links, updates },
      dryRun,
      writer
    );
    const after = dryRun
      ? projectedDistribution(before, analyses, updates)
      : normalizeDistribution(
          await tx
            .select({
              topCircle: itemAnalysis.topCircle,
              count: sql<number>`count(*)::int`
            })
            .from(itemAnalysis)
            .groupBy(itemAnalysis.topCircle)
        );

    return {
      dryRun,
      scannedItems,
      matchedItems: new Set(matchedLinks.map((link) => link.itemId)).size,
      linksToCreate: links.length,
      linksCreated: writeResult.linksCreated,
      topCircleChanges: updates.filter(
        (update) =>
          analyses.get(update.itemId)?.currentTopCircle !== update.topCircle
      ).length,
      qualityScoreChanges: updates.filter((update) =>
        scoreChanged(
          analyses.get(update.itemId)?.currentQualityScore ?? null,
          update.qualityScore
        )
      ).length,
      before,
      after
    };
  });
}

function printStats(stats: BackfillStats): void {
  const mode = stats.dryRun ? "DRY-RUN" : "WRITE";
  console.log(
    `${mode} scanned_items=${stats.scannedItems} matched_items=${stats.matchedItems}`
  );
  console.log(
    `${mode} item_entity_links would_create=${stats.linksToCreate} created=${stats.linksCreated}`
  );
  console.log(
    `${mode} top_circle_changes=${stats.topCircleChanges} quality_score_changes=${stats.qualityScoreChanges}`
  );
  console.log(
    `${mode} top_circle_before C1=${stats.before.C1} C2=${stats.before.C2} C3=${stats.before.C3} NULL=${stats.before.null}`
  );
  console.log(
    `${mode} top_circle_after C1=${stats.after.C1} C2=${stats.after.C2} C3=${stats.after.C3} NULL=${stats.after.null}`
  );
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  const stats = await runBackfillCircles({
    dryRun: process.argv.includes("--dry-run")
  });
  printStats(stats);
  process.exit(0);
}

const isMain = Boolean(
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
