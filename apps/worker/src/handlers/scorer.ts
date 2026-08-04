import { getDb, items, itemAnalysis, itemEntities, entities, listLatestFinancialsByMetric } from "@fe-radar/db";
import type { DbClient } from "@fe-radar/db";
import { eq } from "drizzle-orm";
import { withScrubber } from "@fe-radar/llm";
import { CIRCLE_RANK, computeD3Market, D3_METRIC_KEYS, type EntityFinancialSnapshot } from "@fe-radar/core";

import type { PipelineJob } from "../queues";
import { runScorer } from "../jobs/scorer";

import { logger, handlerContext } from "./context";
import { passesIndustryGate } from "./pipeline-gate";

export async function handleScorerJob(job: { data: PipelineJob }): Promise<void> {
  const db = getDb();
  const itemId = job.data.itemId;
  const correlationId = job.data.correlationId;
  logger.info({ itemId, correlationId, stage: "scorer" }, "pipeline stage");
  if (!await passesIndustryGate(db, itemId)) return;

  const [row] = await db.select({
    title: items.title,
    content: items.content,
  }).from(items).where(eq(items.id, itemId)).limit(1);

  if (!row) return;

  const text = `${row.title}\n${row.content ?? ""}`;
  const result = await runScorer(text, withScrubber(handlerContext.deepSeek));

  // T-ARK-09: d3Market 代码计算 — 仅当 computeD3Market 返回非 null 时覆盖 LLM 的 d3Market；
  // 返回 null 则保留 LLM 的 d3Market（向后兼容，不拉低 qualityScore）
  const codeD3Market = await computeCodeD3Market(db, itemId);
  const d3Market = codeD3Market ?? result.d3Market;

  await db.update(itemAnalysis).set({
    d1Policy: result.d1Policy,
    d3Market,
    d4Tech: result.d4Tech,
    d5Business: result.d5Business,
    summaryZh: result.summaryZh,
    translationZh: result.translationZh,
    category: result.category,
  }).where(eq(itemAnalysis.itemId, itemId));
}

/**
 * T-ARK-09: 代码计算 d3Market。
 * 查 item 命中的 entities，按 topCircle（C1 > C2 > C3）排序，
 * 取最高 circle 对应 entity 的财务数据调 computeD3Market。
 */
async function computeCodeD3Market(db: DbClient, itemId: number): Promise<number | null> {
  const entityRows = await db.select({
    id: entities.id,
    circle: entities.circle,
  }).from(itemEntities)
    .innerJoin(entities, eq(entities.id, itemEntities.entityId))
    .where(eq(itemEntities.itemId, itemId));

  if (entityRows.length === 0) return null;

  const sorted = [...entityRows].sort((a, b) => {
    const rankA = a.circle ? (CIRCLE_RANK[a.circle as keyof typeof CIRCLE_RANK] ?? 0) : 0;
    const rankB = b.circle ? (CIRCLE_RANK[b.circle as keyof typeof CIRCLE_RANK] ?? 0) : 0;
    return rankB - rankA;
  });

  for (const entity of sorted) {
    const records = await listLatestFinancialsByMetric(db, entity.id, D3_METRIC_KEYS);
    const snapshots: EntityFinancialSnapshot[] = records
      .filter((r) => r.value !== null)
      .map((r) => ({ metric: r.metric, value: r.value as number, period: r.period }));
    const score = computeD3Market(snapshots);
    if (score !== null) return score;
  }

  return null;
}
