import { FlowProducer, type Job } from "bullmq";
import { randomUUID } from "node:crypto";

import { getDb, items, itemAnalysis, listSources } from "@fe-radar/db";
import { createLogger } from "@fe-radar/shared";

import type { WebsearchJob } from "../queues";
import { createRedisConnection } from "../queues";
import { enqueueItemPipeline } from "../flows";
import type { FetchContext } from "../fetchers/types";
import { websearchAdapter } from "../fetchers/websearch/adapter";

const logger = createLogger({ service: "websearch" });

/**
 * websearch job handler — 消费 fe-websearch 队列（NER 事件驱动，非定时源）。
 *
 * 约束：
 * - 失败不 markSourceFailure（websearch 非定时源，不走通用 fetch handler）
 * - attempts:3 后静默（BullMQ DEFAULT_JOB_OPTIONS 已配置；不 markSourceFailure）
 * - 禁止在 job 层调 LLM
 * - correlationId 透传到 pipeline
 */
export async function handleWebsearchJob(job: Job<WebsearchJob>): Promise<void> {
  const { entityId, entityName, itemId, correlationId: incomingCorrelationId } = job.data;
  const correlationId = incomingCorrelationId ?? randomUUID();

  const db = getDb();

  // 查 fetcher_type='websearch' 的 source（非定时源，不进 6h 周期）
  const allSources = await listSources(db, { enabled: true });
  const source = allSources.find((s) => (s.fetcherType as string) === "websearch");
  if (!source) {
    logger.warn({ entityId, entityName, correlationId }, "websearch source not found or disabled, skipping");
    return;
  }

  const ctx: FetchContext = {
    sourceName: source.name,
    useRealUa: false,
    sourceConfig: { ...(source.config as Record<string, unknown>), query: entityName },
  };

  // adapter 契约：失败返回 [] 不抛异常（websearch 有独立 job handler）
  const results = await websearchAdapter.fetch(ctx);

  if (results.length === 0) {
    // 空结果是正常结束，非失败（websearch 非定时源，不 markSourceFailure）
    logger.info({ entityId, entityName, correlationId }, "websearch returned no results");
    return;
  }

  logger.info({ entityId, entityName, correlationId, count: results.length }, "websearch fetched results");

  const redis = createRedisConnection();
  const flowProducer = new FlowProducer({ connection: redis });

  try {
    for (const item of results) {
      const [inserted] = await db
        .insert(items)
        .values({
          sourceId: source.id,
          url: item.url,
          title: item.title,
          content: item.content,
          publishedAt: item.publishedAt,
        })
        .onConflictDoNothing()
        .returning({ id: items.id });

      if (!inserted) continue;

      await db.insert(itemAnalysis).values({
        itemId: inserted.id,
        isIndustryRelated: null,
        quotaState: "admitted",
      });

      await enqueueItemPipeline(flowProducer, inserted.id, correlationId);
      logger.info(
        { itemId: inserted.id, correlationId, sourceId: source.id, entityId, triggerItemId: itemId, stage: "websearch" },
        "pipeline enqueued",
      );
    }

    logger.info({ entityId, entityName, correlationId, count: results.length }, "websearch job completed");
  } finally {
    await flowProducer.close();
    await redis.quit();
  }
}
