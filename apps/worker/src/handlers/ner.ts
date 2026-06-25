import { getDb, items, itemEntities, entities } from "@fe-radar/db";
import { eq, and, inArray } from "drizzle-orm";
import { withScrubber } from "@fe-radar/llm";
import { admitWebSearch, type RedisEvalLike } from "@fe-radar/core";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

import type { PipelineJob, WebsearchJob } from "../queues";
import { createRedisConnection, createWebsearchQueue } from "../queues";
import { runNer } from "../jobs/ner";

import { logger, handlerContext, loadEntityDictionary } from "./context";

export async function handleNerJob(job: { data: PipelineJob }): Promise<void> {
  const db = getDb();
  const itemId = job.data.itemId;
  const correlationId = job.data.correlationId;
  logger.info({ itemId, correlationId, stage: "ner" }, "pipeline stage");
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
    if (entity.canonicalName) {
      const [existing] = await db.select({ id: entities.id }).from(entities)
        .where(and(eq(entities.type, entity.type), eq(entities.canonicalName, entity.canonicalName)))
        .limit(1);
      if (existing) {
        await db.insert(itemEntities).values({ itemId, entityId: existing.id, span: entity.text }).onConflictDoNothing();
      }
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
