import { getDb, items, itemAnalysis, itemEntities, entities, sources } from "@fe-radar/db";
import { eq } from "drizzle-orm";
import { curateItem } from "@fe-radar/core";
import type { EntityHit } from "@fe-radar/core";

import type { PipelineJob } from "../queues";

import { handlerContext, logger, loadScoringConfig, loadOwnCompanyProfile } from "./context";
import { passesIndustryGate } from "./pipeline-gate";

export async function handleCuratorJob(job: { data: PipelineJob }): Promise<void> {
  const db = getDb();
  const itemId = job.data.itemId;
  const correlationId = job.data.correlationId;
  logger.info({ itemId, correlationId, stage: "curator" }, "pipeline stage");

  if (!await passesIndustryGate(db, itemId)) {
    await db.update(itemAnalysis).set({
      isCurated: false,
      alertType: null,
      alertLevel: null,
    }).where(eq(itemAnalysis.itemId, itemId));
    return;
  }

  const [itemRow] = await db.select({
    sourceId: items.sourceId,
    title: items.title,
    content: items.content,
  }).from(items).where(eq(items.id, itemId)).limit(1);
  if (!itemRow) return;

  const [sourceRow] = await db.select({
    tier: sources.tier,
    category: sources.category,
    config: sources.config,
  }).from(sources).where(eq(sources.id, itemRow.sourceId)).limit(1);
  if (!sourceRow) return;

  // 风险检索关键词必须来自 source config，避免用代码默认词绕过数据库配置。
  const sourceConfig = (sourceRow.config ?? {}) as Record<string, unknown>;
  const riskEntityKeywords = toStringArray(sourceConfig.entityKeywords);
  const riskKeywords = toStringArray(sourceConfig.riskKeywords);

  const [analysis] = await db.select().from(itemAnalysis).where(eq(itemAnalysis.itemId, itemId)).limit(1);
  if (!analysis) return;

  const entityRows = await db.select({
    id: entities.id,
    type: entities.type,
    canonicalName: entities.canonicalName,
    circle: entities.circle,
  }).from(itemEntities)
    .innerJoin(entities, eq(entities.id, itemEntities.entityId))
    .where(eq(itemEntities.itemId, itemId));

  const entityHits: EntityHit[] = entityRows.map((r) => ({
    id: r.id,
    type: r.type,
    canonicalName: r.canonicalName,
    circle: r.circle as "C1" | "C2" | "C3" | null,
  }));

  const config = await loadScoringConfig();
  const ownCompanyProfile = await loadOwnCompanyProfile();
  const result = curateItem({
    atoms: {
      d1Policy: analysis.d1Policy ?? 0,
      d3Market: analysis.d3Market ?? 0,
      d4Tech: analysis.d4Tech ?? 0,
      d5Business: analysis.d5Business ?? 0,
    },
    source: { tier: sourceRow.tier as "T1" | "T2" | "T3" },
    entities: entityHits,
    config,
    category: analysis.category ?? "公司与资本",
    title: itemRow.title,
    content: itemRow.content ?? undefined,
    sourceCategory: sourceRow.category,
    riskEntityKeywords,
    riskKeywords,
    ownCompanyProfile,
  });

  await db.update(itemAnalysis).set({
    d2Chain: result.d2Chain,
    qualityScore: result.qualityScore,
    topCircle: result.topCircle,
    isCurated: result.isCurated,
    alertType: result.alertType ?? null,
    alertLevel: result.alertLevel ?? null,
    scoredAt: new Date(),
  }).where(eq(itemAnalysis.itemId, itemId));

  const q = handlerContext.detailFetchQueue;
  if (!q) {
    logger.debug({ itemId }, "detail-fetch skipped: queue not injected");
  } else {
    try {
      await q.add("detail-fetch", { itemId });
    } catch (err) {
      logger.warn({ err, itemId }, "detail-fetch enqueue failed");
    }
  }
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
  return cleaned.length > 0 ? cleaned : undefined;
}
