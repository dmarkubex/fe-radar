import { randomUUID } from "node:crypto";
import {
  admitToScoring,
  detectPriorityFromText,
  rollbackAdmit,
  type RedisEvalLike
} from "@fe-radar/core";
import {
  getDb,
  items,
  itemAnalysis,
  sources,
  markSourceSuccess
} from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";
import { and, eq, sql } from "drizzle-orm";

import type { FetchSourceJob } from "../queues";
import { createRedisConnection } from "../queues";
import { enqueueEnabledSources, recordSourceFailure } from "../scheduler";
import { fetchSourceItems } from "../fetchers";
import type { SourceConfig, StandardItem, FetchContext } from "../fetchers";
import {
  dedupItems,
  type DedupCandidate,
  type ExistingItemFingerprint
} from "../dedup";
import { getOrCreatePlaywrightPool } from "../lib/playwright-pool";
import { drainPendingQuotaBacklog } from "../jobs/quota-drain";

import { logger, handlerContext, loadOwnCompanyProfile } from "./context";

function scoringBusinessDate(now = new Date()): string {
  return dayjs(now).tz(APP_TIMEZONE).format("YYYY-MM-DD");
}

export function filterGate0MaxAge(
  sourceItems: StandardItem[],
  config: SourceConfig,
  now = new Date()
): StandardItem[] {
  const maxAgeHours = (
    config as SourceConfig & { gate0?: { maxAgeHours?: unknown } }
  ).gate0?.maxAgeHours;
  if (
    typeof maxAgeHours !== "number" ||
    !Number.isFinite(maxAgeHours) ||
    maxAgeHours <= 0
  ) {
    return sourceItems;
  }
  const cutoff = now.getTime() - maxAgeHours * 60 * 60 * 1_000;
  return sourceItems.filter(
    (item) => item.publishedAt.getTime() >= cutoff
  );
}

export async function handleFetchJob(job: {
  data: FetchSourceJob;
}): Promise<void> {
  const db = getDb();
  const sourceId = job.data.sourceId;

  if (sourceId === 0) {
    const { createFetchQueue } = await import("../queues");
    // BullMQ marks a passed-in IORedis instance as "shared" and Queue.close()
    // will NOT quit it (redis-connection.js: `if (!shared) quit()`). So build the
    // connection explicitly and quit it ourselves, otherwise it leaks per cycle.
    const conn = createRedisConnection();
    const queue = createFetchQueue(conn);
    try {
      // design §5.1：每个 6h 窗口前先消化 backlog，再抓取新源
      try {
        const drain = await drainPendingQuotaBacklog({
          db,
          redis: conn as unknown as RedisEvalLike
        });
        logger.info(drain, "quota backlog drained");
      } catch (drainError) {
        logger.warn(
          { error: drainError },
          "quota backlog drain skipped; fetch scheduling continues"
        );
      }
      const count = await enqueueEnabledSources(db, queue);
      logger.info({ count }, "scheduled fetch cycle");
    } finally {
      await queue.close();
      await conn.quit();
    }
    return;
  }

  const [source] = await db
    .select()
    .from(sources)
    .where(eq(sources.id, sourceId))
    .limit(1);
  if (!source || !source.enabled) {
    logger.info({ sourceId }, "source not found or disabled, skipping");
    return;
  }

  const config = source.config as SourceConfig;
  const context: FetchContext = {
    sourceName: source.name,
    useRealUa: (config as unknown as Record<string, unknown>).useRealUa === true
  };

  let rawItems: StandardItem[];
  try {
    if (config.type === "playwright" && !handlerContext.playwrightPool) {
      // T-CA-04: 懒建走全局 getter —— 生产路径唯一允许的 createPlaywrightPool 在其内部。
      handlerContext.playwrightPool = await getOrCreatePlaywrightPool();
    }
    rawItems = await fetchSourceItems(
      config,
      context,
      handlerContext.playwrightPool
    );
  } catch (error) {
    logger.error(
      { error, sourceId: source.id, sourceName: source.name },
      "fetch failed"
    );
    const message = error instanceof Error ? error.message : String(error);
    await recordSourceFailure(
      db,
      { id: source.id, failCount: source.failCount },
      message
    );
    throw error;
  }

  logger.info(
    { sourceId, sourceName: source.name, count: rawItems.length },
    "fetch succeeded"
  );

  // Fix-3: 宽口径 RSS/HTML 信源关键词白名单过滤（pre-dedup，减少 LLM 调用）
  if (
    (config.type === "rss" || config.type === "html") &&
    config.keywordFilter &&
    config.keywordFilter.length > 0
  ) {
    const kf = config.keywordFilter;
    const before = rawItems.length;
    rawItems = rawItems.filter((item) => {
      const text = `${item.title} ${item.content ?? ""}`.toLowerCase();
      return kf.some((kw) => text.includes(kw.toLowerCase()));
    });
    const filtered = before - rawItems.length;
    if (filtered > 0) {
      logger.warn(
        { sourceId, sourceName: source.name, filtered, kept: rawItems.length },
        "keyword filter dropped items"
      );
    }
  }

  const beforeAgeFilter = rawItems.length;
  rawItems = filterGate0MaxAge(rawItems, config);
  if (rawItems.length < beforeAgeFilter) {
    logger.info(
      {
        sourceId,
        sourceName: source.name,
        filtered: beforeAgeFilter - rawItems.length,
        kept: rawItems.length
      },
      "gate0 max-age filter dropped stale items"
    );
  }

  const candidates: DedupCandidate[] = rawItems.map((item) => ({
    ...item,
    sourceId: source.id
  }));

  const existing = (await db
    .select({
      sourceId: items.sourceId,
      url: items.url,
      title: items.title,
      publishedDate: sql<string>`${items.publishedAt}::date`
    })
    .from(items)
    .where(eq(items.sourceId, source.id))) as ExistingItemFingerprint[];

  const { accepted } = dedupItems(candidates, existing);

  if (accepted.length === 0) {
    await markSourceSuccess(db, source.id);
    return;
  }

  const { FlowProducer } = await import("bullmq");
  const redis = createRedisConnection();
  const flowProducer = new FlowProducer({ connection: redis });
  const businessDate = scoringBusinessDate();
  // 本公司 profile（注入 detectPriorityFromText，避免「远东」2字子串误判 + 满足 DB 配置约束）
  const ownCompanyProfile = await loadOwnCompanyProfile();
  let admittedCount = 0;
  let pendingCount = 0;
  let failedCount = 0;

  try {
    for (const item of accepted) {
      let itemId: number | undefined;
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
              publishedAt: item.publishedAt
            })
            .returning({ id: items.id });

          if (!inserted) return { skipped: true as const };
          itemId = inserted.id;

          const isPriority = detectPriorityFromText(
            item.title,
            item.content,
            ownCompanyProfile
          );
          const decision = await admitToScoring(
            { itemId, isPriority, businessDate },
            redis as unknown as RedisEvalLike
          );
          if (decision.state === "admitted")
            admittedCounterKey = decision.counterKey;

          // Analysis must exist before BullMQ can expose the item to prefilter.
          await tx.insert(itemAnalysis).values({
            itemId,
            isIndustryRelated: null,
            quotaState: decision.state
          });
          return { skipped: false as const, itemId, decision, isPriority };
        });

        if (result.skipped) continue;
        if (result.decision.state !== "admitted") {
          pendingCount += 1;
          logger.info(
            {
              itemId: result.itemId,
              sourceId: source.id,
              isPriority: result.isPriority,
              quotaState: result.decision.state,
              counterKey: result.decision.counterKey
            },
            "item pending_over_quota, pipeline not enqueued"
          );
          continue;
        }

        admittedAnalysisWritten = true;
        const correlationId = randomUUID();
        const { enqueueItemPipeline } = await import("../flows");
        await enqueueItemPipeline(flowProducer, result.itemId, correlationId);
        admittedCount += 1;
        logger.info(
          {
            itemId: result.itemId,
            correlationId,
            sourceId: source.id,
            stage: "fetch",
            isPriority: result.isPriority
          },
          "pipeline enqueued"
        );
      } catch (error) {
        failedCount += 1;
        const compensationErrors: unknown[] = [];
        if (itemId != null && admittedAnalysisWritten) {
          try {
            await db
              .update(itemAnalysis)
              .set({ quotaState: "pending_over_quota" })
              .where(
                and(
                  eq(itemAnalysis.itemId, itemId),
                  eq(itemAnalysis.quotaState, "admitted")
                )
              );
            pendingCount += 1;
          } catch (rollbackStateError) {
            compensationErrors.push(rollbackStateError);
          }
        }
        if (admittedCounterKey) {
          try {
            await rollbackAdmit(
              admittedCounterKey,
              redis as unknown as RedisEvalLike
            );
          } catch (rollbackQuotaError) {
            compensationErrors.push(rollbackQuotaError);
          }
        }
        logger.error(
          { error, compensationErrors, itemId, sourceId: source.id },
          "item persistence or pipeline enqueue failed; continuing batch"
        );
      }
    }

    if (failedCount === 0) {
      await markSourceSuccess(db, source.id);
    } else {
      logger.warn(
        {
          sourceId,
          accepted: accepted.length,
          admitted: admittedCount,
          pendingOverQuota: pendingCount,
          failedCount
        },
        "source fetch succeeded but item persistence or enqueue failed; markSourceSuccess skipped"
      );
    }
    logger.info(
      {
        sourceId,
        accepted: accepted.length,
        admitted: admittedCount,
        pendingOverQuota: pendingCount,
        skipped: candidates.length - accepted.length
      },
      "items inserted and pipeline enqueued"
    );
  } finally {
    // FlowProducer was given an external connection; close both so neither leaks.
    await flowProducer.close();
    await redis.quit();
  }
}
