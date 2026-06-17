import { randomUUID } from "node:crypto";
import { getDb, items, itemAnalysis, sources, markSourceSuccess } from "@fe-radar/db";
import { eq, sql } from "drizzle-orm";

import type { FetchSourceJob } from "../queues";
import { createRedisConnection } from "../queues";
import { enqueueEnabledSources, recordSourceFailure } from "../scheduler";
import { fetchRss, fetchHtml, fetchPlaywright, fetchAnnouncements, fetchCrawl } from "../fetchers";
import type { SourceConfig, StandardItem, FetchContext } from "../fetchers";
import { dedupItems, type DedupCandidate, type ExistingItemFingerprint } from "../dedup";
import { createPlaywrightPool } from "../fetchers/playwright";

import { logger, handlerContext } from "./context";

export async function handleFetchJob(job: { data: FetchSourceJob }): Promise<void> {
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
      const count = await enqueueEnabledSources(db, queue);
      logger.info({ count }, "scheduled fetch cycle");
    } finally {
      await queue.close();
      await conn.quit();
    }
    return;
  }

  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  if (!source || !source.enabled) {
    logger.info({ sourceId }, "source not found or disabled, skipping");
    return;
  }

  const config = source.config as SourceConfig;
  const context: FetchContext = { sourceName: source.name, useRealUa: (config as unknown as Record<string, unknown>).useRealUa === true };

  let rawItems: StandardItem[];
  try {
    switch (config.type) {
      case "rss":
        rawItems = await fetchRss(config, context);
        break;
      case "html":
        rawItems = await fetchHtml(config, context);
        break;
      case "playwright":
        if (!handlerContext.playwrightPool) {
          handlerContext.playwrightPool = await createPlaywrightPool();
        }
        rawItems = await fetchPlaywright(config, context, handlerContext.playwrightPool);
        break;
      case "announcement":
        rawItems = await fetchAnnouncements(config, context);
        break;
      case "crawl":
        rawItems = await fetchCrawl(config, context);
        break;
      default:
        throw new Error(`Unknown fetcher type: ${(config as { type: string }).type}`);
    }
  } catch (error) {
    logger.error({ error, sourceId: source.id, sourceName: source.name }, "fetch failed");
    const message = error instanceof Error ? error.message : String(error);
    await recordSourceFailure(db, { id: source.id, failCount: source.failCount }, message);
    throw error;
  }

  logger.info({ sourceId, sourceName: source.name, count: rawItems.length }, "fetch succeeded");

  const candidates: DedupCandidate[] = rawItems.map((item) => ({
    ...item,
    sourceId: source.id,
  }));

  const existing = await db
    .select({ sourceId: items.sourceId, url: items.url, title: items.title, publishedDate: sql<string>`${items.publishedAt}::date` })
    .from(items)
    .where(eq(items.sourceId, source.id)) as ExistingItemFingerprint[];

  const { accepted } = dedupItems(candidates, existing);

  if (accepted.length === 0) {
    await markSourceSuccess(db, source.id);
    return;
  }

  const { FlowProducer } = await import("bullmq");
  const redis = createRedisConnection();
  const flowProducer = new FlowProducer({ connection: redis });

  try {
    for (const item of accepted) {
      const [inserted] = await db.insert(items).values({
        sourceId: source.id,
        url: item.url,
        title: item.title,
        content: item.content,
        publishedAt: item.publishedAt,
      }).returning({ id: items.id });

      if (!inserted) continue;

      await db.insert(itemAnalysis).values({
        itemId: inserted.id,
        isIndustryRelated: null,
        quotaState: "admitted",
      });

      const correlationId = randomUUID();
      const { enqueueItemPipeline } = await import("../flows");
      await enqueueItemPipeline(flowProducer, inserted.id, correlationId);
      logger.info({ itemId: inserted.id, correlationId, sourceId: source.id, stage: "fetch" }, "pipeline enqueued");
    }

    await markSourceSuccess(db, source.id);
    logger.info({ sourceId, accepted: accepted.length, skipped: candidates.length - accepted.length }, "items inserted and pipeline enqueued");
  } finally {
    // FlowProducer was given an external connection; close both so neither leaks.
    await flowProducer.close();
    await redis.quit();
  }
}
