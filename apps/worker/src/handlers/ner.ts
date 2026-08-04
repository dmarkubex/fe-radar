import { getDb, items, itemEntities, entities } from "@fe-radar/db";
import { eq, and, inArray, arrayContains, sql, desc } from "drizzle-orm";
import { withScrubber } from "@fe-radar/llm";
import { admitWebSearch, type RedisEvalLike } from "@fe-radar/core";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

import type { PipelineJob, WebsearchJob } from "../queues";
import { createRedisConnection, createWebsearchQueue } from "../queues";
import { runNer } from "../jobs/ner";

import { logger, handlerContext, loadEntityDictionary } from "./context";
import { passesIndustryGate } from "./pipeline-gate";

/** C1 > C2 > C3 > null — used when alias fallback hits multiple entities. */
const CIRCLE_RANK_SQL = sql`CASE ${entities.circle}
  WHEN 'C1' THEN 1
  WHEN 'C2' THEN 2
  WHEN 'C3' THEN 3
  ELSE 4
END`;

const CIRCLE_RANK: Record<string, number> = { C1: 1, C2: 2, C3: 3 };
const MAX_DYNAMIC_POLICY_NAME_LENGTH = 100;

export interface AliasHitCandidate {
  id: number;
  circle: string | null;
  weight: number;
}

/**
 * Disambiguate multiple alias hits: circle C1>C2>C3>null, then weight DESC.
 * Pure function so unit tests can verify the rule without relying on SQL mock ordering.
 */
export function pickBestAliasHit(hits: AliasHitCandidate[]): AliasHitCandidate | null {
  if (hits.length === 0) return null;
  return [...hits].sort((a, b) => {
    const ra = CIRCLE_RANK[a.circle ?? ""] ?? 4;
    const rb = CIRCLE_RANK[b.circle ?? ""] ?? 4;
    if (ra !== rb) return ra - rb;
    return b.weight - a.weight;
  })[0]!;
}

/**
 * Resolve LLM-extracted name → entities.id.
 * 1) exact match on (type, canonicalName)
 * 2) fallback: aliases @> ARRAY[name], disambiguate by circle then weight
 * 3) policy and normalized accident event_type only: persist a dynamic entity so curator can JOIN it
 */
export async function resolveEntityId(
  db: ReturnType<typeof getDb>,
  type: string,
  extractedName: string,
  itemId: number,
): Promise<number | null> {
  const [byCanonical] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.type, type), eq(entities.canonicalName, extractedName)))
    .limit(1);
  if (byCanonical) return byCanonical.id;

  // Fetch all alias matches (ORDER BY is a DB hint; authoritative pick is pickBestAliasHit).
  const aliasHits = await db
    .select({
      id: entities.id,
      circle: entities.circle,
      weight: entities.weight,
    })
    .from(entities)
    .where(and(eq(entities.type, type), arrayContains(entities.aliases, [extractedName])))
    .orderBy(CIRCLE_RANK_SQL, desc(entities.weight));

  const hit = pickBestAliasHit(aliasHits);
  if (!hit) {
    if (type !== "policy" && type !== "event_type") return null;
    if (type === "event_type" && extractedName !== "事故") return null;
    if (type === "policy" && extractedName.length > MAX_DYNAMIC_POLICY_NAME_LENGTH) {
      logger.warn(
        {
          itemId,
          extractedName: extractedName.slice(0, MAX_DYNAMIC_POLICY_NAME_LENGTH),
          extractedNameLength: extractedName.length,
          maxLength: MAX_DYNAMIC_POLICY_NAME_LENGTH,
        },
        "dynamic policy entity rejected: name too long",
      );
      return null;
    }

    const meta = type === "policy" ? { source: "dynamic" } : undefined;

    const [dynamicEntity] = await db
      .insert(entities)
      .values({ type, canonicalName: extractedName, ...(meta ? { meta } : {}) })
      .onConflictDoUpdate({
        target: [entities.type, entities.canonicalName],
        set: { canonicalName: extractedName, ...(meta ? { meta } : {}) },
      })
      .returning({ id: entities.id });
    return dynamicEntity?.id ?? null;
  }

  logger.info(
    {
      itemId,
      extractedName,
      entityId: hit.id,
      circle: hit.circle,
      match: "alias_fallback",
    },
    "NER entity resolved via alias fallback",
  );
  return hit.id;
}

export async function handleNerJob(job: { data: PipelineJob }): Promise<void> {
  const db = getDb();
  const itemId = job.data.itemId;
  const correlationId = job.data.correlationId;
  logger.info({ itemId, correlationId, stage: "ner" }, "pipeline stage");
  if (!await passesIndustryGate(db, itemId)) return;

  const [row] = await db.select({
    title: items.title,
    content: items.content,
  }).from(items).where(eq(items.id, itemId)).limit(1);

  if (!row) return;

  const text = `${row.title}\n${row.content ?? ""}`;
  const dict = await loadEntityDictionary();
  const result = await runNer(
    text,
    dict,
    withScrubber(handlerContext.qwen),
    withScrubber(handlerContext.deepSeek),
  );

  for (const entity of result.entities) {
    if (!entity.canonicalName) continue;
    const entityId = await resolveEntityId(db, entity.type, entity.canonicalName, itemId);
    if (entityId != null) {
      await db.insert(itemEntities).values({ itemId, entityId, span: entity.text }).onConflictDoNothing();
    }
  }

  // T-ARK-17 — best-effort websearch trigger for C1/C2 entities hit in this
  // NER run. Side-effect only: it must never block the NER main flow (Redis
  // down or monthly quota exhausted → warn + continue).
  try {
    const c1c2Hits = await db.select({
      entityId: entities.id,
      canonicalName: entities.canonicalName,
      circle: entities.circle,
    })
      .from(itemEntities)
      .innerJoin(entities, eq(itemEntities.entityId, entities.id))
      .where(and(eq(itemEntities.itemId, itemId), inArray(entities.circle, ["C1", "C2"])));

    if (c1c2Hits.length === 0) return;

    const yearMonth = dayjs().tz(APP_TIMEZONE).format("YYYY-MM");
    const conn = createRedisConnection();
    const queue = createWebsearchQueue(conn);
    try {
      for (const hit of c1c2Hits) {
        const cooldownKey = `websearch:entity:${hit.entityId}:24h`;
        // Cooldown first (skip already-searched entities before consuming a
        // monthly quota incr — reduces wasted increments on deduped entities).
        if (await conn.get(cooldownKey)) continue;

        const decision = await admitWebSearch(yearMonth, conn as unknown as RedisEvalLike);
        if (decision.state === "pending_over_quota") {
          logger.warn(
            { entityId: hit.entityId, entityName: hit.canonicalName, monthKey: yearMonth },
            "websearch monthly quota exhausted, discarding (no retry)"
          );
          continue;
        }

        const payload: WebsearchJob = {
          entityId: hit.entityId,
          entityName: hit.canonicalName,
          itemId,
          correlationId,
        };
        // P1-1: 入队 + 写冷却放同一保护段；任一步失败则 DECR 回滚配额
        try {
          await queue.add("websearch", payload);
          await conn.set(cooldownKey, "1", "EX", 86400);
          logger.info(
            { entityId: hit.entityId, entityName: hit.canonicalName, itemId, correlationId },
            "websearch enqueued for C1/C2 entity"
          );
        } catch (enqueueError) {
          // 回滚配额计数（admitWebSearch 已 INCR，入队失败需 DECR）
          await conn.decr(decision.counterKey!);
          logger.warn(
            { entityId: hit.entityId, entityName: hit.canonicalName, error: enqueueError },
            "websearch enqueue failed, quota rolled back"
          );
        }
      }
    } finally {
      await queue.close();
      await conn.quit();
    }
  } catch (error) {
    logger.warn({ itemId, correlationId, error }, "websearch trigger failed, NER continues");
  }
}
