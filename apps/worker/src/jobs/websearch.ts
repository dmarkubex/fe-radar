import { FlowProducer, type Job } from "bullmq";
import { randomUUID } from "node:crypto";

import { admitToScoring, detectPriorityFromText, rollbackAdmit, type RedisEvalLike } from "@fe-radar/core";
import { getDb, items, itemAnalysis, listSources } from "@fe-radar/db";
import { APP_TIMEZONE, createLogger, dayjs } from "@fe-radar/shared";
import { and, eq } from "drizzle-orm";

import type { WebsearchJob } from "../queues";
import { createRedisConnection } from "../queues";
import { enqueueItemPipeline } from "../flows";
import type { FetchContext } from "../fetchers/types";
import { websearchAdapter } from "../fetchers/websearch/adapter";
import { loadOwnCompanyProfile } from "../handlers/context";

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
  // T1（Finding #1）：websearch 结果入 pipeline 前必须经 admitToScoring（每日 LLM 评分配额）。
  // 此前硬编码 quotaState:"admitted" 绕过配额，NER 驱动的 websearch 可无限消耗 NFR-01 1500 条上限。
  // 与 fetch.ts 完全对称；NER 驱动的 admitWebSearch（月度 API 配额）是另一层独立限速，互不冲突。
  const businessDate = dayjs().tz(APP_TIMEZONE).format("YYYY-MM-DD");
  const ownCompanyProfile = await loadOwnCompanyProfile();

  try {
    for (const item of results) {
      let insertedItemId: number | undefined;
      let admittedCounterKey: string | undefined;
      let admittedAnalysisWritten = false;
      try {
        const result = await db.transaction(async (tx) => {
          const [inserted] = await tx
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

          if (!inserted) return { skipped: true as const };
          insertedItemId = inserted.id;

          const isPriority = detectPriorityFromText(item.title, item.content, ownCompanyProfile);
          const decision = await admitToScoring(
            { itemId: insertedItemId, isPriority, businessDate },
            redis as unknown as RedisEvalLike
          );
          if (decision.state === "admitted") admittedCounterKey = decision.counterKey;

          // Analysis must exist before BullMQ can expose the item to prefilter.
          await tx.insert(itemAnalysis).values({
            itemId: insertedItemId,
            isIndustryRelated: null,
            quotaState: decision.state,
          });
          return { skipped: false as const, itemId: insertedItemId, decision, isPriority };
        });

        if (result.skipped) continue;
        if (result.decision.state !== "admitted") {
          logger.info(
            { itemId: result.itemId, correlationId, sourceId: source.id, isPriority: result.isPriority, quotaState: result.decision.state, counterKey: result.decision.counterKey },
            "websearch item pending_over_quota, pipeline not enqueued",
          );
          continue;
        }

        admittedAnalysisWritten = true;
        await enqueueItemPipeline(flowProducer, result.itemId, correlationId);
        logger.info(
          { itemId: result.itemId, correlationId, sourceId: source.id, entityId, triggerItemId: itemId, stage: "websearch" },
          "pipeline enqueued",
        );
      } catch (error) {
        const compensationErrors: unknown[] = [];
        if (insertedItemId != null && admittedAnalysisWritten) {
          try {
            await db.update(itemAnalysis).set({ quotaState: "pending_over_quota" }).where(and(
              eq(itemAnalysis.itemId, insertedItemId),
              eq(itemAnalysis.quotaState, "admitted")
            ));
          } catch (rollbackStateError) {
            compensationErrors.push(rollbackStateError);
          }
        }
        if (admittedCounterKey) {
          try {
            await rollbackAdmit(admittedCounterKey, redis as unknown as RedisEvalLike);
          } catch (rollbackQuotaError) {
            compensationErrors.push(rollbackQuotaError);
          }
        }
        logger.error({ error, compensationErrors, itemId: insertedItemId, sourceId: source.id }, "websearch item failed; continuing batch");
      }
    }

    logger.info({ entityId, entityName, correlationId, count: results.length }, "websearch job completed");
  } finally {
    await flowProducer.close();
    await redis.quit();
  }
}
