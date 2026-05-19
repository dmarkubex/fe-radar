import { Worker } from "bullmq";
import pino from "pino";

import { QUEUES } from "@fe-radar/shared";
import { getDb, items, itemAnalysis, itemEntities, clusterItems, clusters, entities, scoringConfig, sources, markSourceSuccess } from "@fe-radar/db";
import { eq, and, sql } from "drizzle-orm";
import { createQwenClient, createDeepSeekClient, createKimiClient, withScrubber } from "@fe-radar/llm";
import type { LlmClient } from "@fe-radar/llm";
import { curateItem } from "@fe-radar/core";
import type { ScoringConfig as CoreScoringConfig, EntityHit } from "@fe-radar/core";

import type { FetchSourceJob, PipelineJob, QuotesFetchJob } from "./queues";
import { createRedisConnection, FETCH_SCHEDULE_CRON, FETCH_SCHEDULE_TZ, DAILY_REPORT_SCHEDULE_CRON, DAILY_REPORT_SCHEDULE_TZ, DEFAULT_JOB_OPTIONS, QUEUE_QUOTES_FETCH } from "./queues";
import { enqueueEnabledSources, recordSourceFailure, enqueueEnabledQuotesSources, scheduleQuotesFetchCron } from "./scheduler";
import { fetchRss, fetchHtml, fetchPlaywright } from "./fetchers";
import type { SourceConfig, StandardItem, FetchContext } from "./fetchers";
import { dedupItems, type DedupCandidate, type ExistingItemFingerprint } from "./dedup";
import { runPrefilter } from "./jobs/prefilter";
import { runScorer } from "./jobs/scorer";
import { runNer } from "./jobs/ner";
import { runEmbedder } from "./jobs/embedder";
import { withClusterCreateLock } from "./jobs/cluster";
import { runDailyGen } from "./jobs/daily-gen";
import { runCleanup, CLEANUP_SCHEDULE_CRON, CLEANUP_SCHEDULE_TZ } from "./jobs/cleanup";
import { runQuotesFetch } from "./jobs/quotes-fetch";
import { EntityDictionary } from "./lib/entities-dict";
import { FETCH_CONCURRENCY } from "./scheduler";
import { createPlaywrightPool, type BrowserContextPool } from "./fetchers/playwright";

const logger = pino({ name: "fe-radar-worker" });

let qwen: LlmClient;
let deepSeek: LlmClient;
let kimi: LlmClient;
let playwrightPool: BrowserContextPool;

async function loadScoringConfig(): Promise<CoreScoringConfig> {
  const db = getDb();
  const rows = await db.select().from(scoringConfig);
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value as Record<string, unknown>]));
  return {
    weights: (byKey.weights as CoreScoringConfig["weights"]) ?? { w1: 0.20, w2: 0.25, w3: 0.20, w4: 0.15, w5: 0.20 },
    tCoef: (byKey.t_coef as CoreScoringConfig["tCoef"]) ?? { T1: 1.0, T2: 0.85, T3: 0.70 },
    cCoef: (byKey.c_coef as CoreScoringConfig["cCoef"]) ?? { C1: 1.2, C2: 1.0, C3: 0.85 },
    thresholds: (byKey.thresholds as CoreScoringConfig["thresholds"]) ?? {
      "政策与标准": { C1: 55, C2: 60, C3: 65 },
      "市场与价格": { C1: 55, C2: 60, C3: 70 },
      "技术与产品": { C1: 55, C2: 65, C3: 75 },
      "项目与招投标": { C1: 50, C2: 60, C3: 70 },
      "公司与资本": { C1: 55, C2: 65, C3: 75 },
    },
  };
}

async function loadEntityDictionary(): Promise<EntityDictionary> {
  const db = getDb();
  const rows = await db.select({
    id: entities.id,
    type: entities.type,
    canonicalName: entities.canonicalName,
    aliases: entities.aliases,
    circle: entities.circle,
  }).from(entities);
  return new EntityDictionary(rows.map((r) => ({
    id: r.id,
    type: r.type,
    canonicalName: r.canonicalName,
    aliases: r.aliases ?? [],
    circle: r.circle as "C1" | "C2" | "C3" | null,
  })));
}

async function handleFetchJob(job: { data: FetchSourceJob }): Promise<void> {
  const db = getDb();
  const sourceId = job.data.sourceId;

  if (sourceId === 0) {
    const queue = await import("./queues").then((m) => m.createFetchQueue());
    const count = await enqueueEnabledSources(db, queue);
    logger.info({ count }, "scheduled fetch cycle");
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
        if (!playwrightPool) {
          playwrightPool = await createPlaywrightPool();
        }
        rawItems = await fetchPlaywright(config, context, playwrightPool);
        break;
      default:
        throw new Error(`Unknown fetcher type: ${(config as { type: string }).type}`);
    }
  } catch (error) {
    logger.error({ error, sourceId: source.id, sourceName: source.name }, "fetch failed");
    await recordSourceFailure(db, { id: source.id, failCount: source.failCount });
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

    const { enqueueItemPipeline } = await import("./flows");
    await enqueueItemPipeline(flowProducer, inserted.id);
  }

  await markSourceSuccess(db, source.id);
  logger.info({ sourceId, accepted: accepted.length, skipped: candidates.length - accepted.length }, "items inserted and pipeline enqueued");
}

async function handlePrefilterJob(job: { data: PipelineJob }): Promise<void> {
  const db = getDb();
  const itemId = job.data.itemId;
  const [row] = await db.select({
    title: items.title,
    content: items.content,
  }).from(items).where(eq(items.id, itemId)).limit(1);

  if (!row) {
    logger.warn({ itemId }, "item not found for prefilter");
    return;
  }

  const result = await runPrefilter(
    { title: row.title, content: row.content ?? row.title },
    withScrubber(qwen),
    withScrubber(deepSeek),
  );

  await db.update(itemAnalysis).set({
    isIndustryRelated: result.isIndustryRelated === true,
  }).where(eq(itemAnalysis.itemId, itemId));
}

async function handleNerJob(job: { data: PipelineJob }): Promise<void> {
  const db = getDb();
  const itemId = job.data.itemId;
  const [row] = await db.select({
    title: items.title,
    content: items.content,
  }).from(items).where(eq(items.id, itemId)).limit(1);

  if (!row) return;

  const text = `${row.title}\n${row.content ?? ""}`;
  const dict = await loadEntityDictionary();
  const result = await runNer(text, dict, withScrubber(qwen));

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
}

async function handleScorerJob(job: { data: PipelineJob }): Promise<void> {
  const db = getDb();
  const itemId = job.data.itemId;
  const [row] = await db.select({
    title: items.title,
    content: items.content,
  }).from(items).where(eq(items.id, itemId)).limit(1);

  if (!row) return;

  const text = `${row.title}\n${row.content ?? ""}`;
  const result = await runScorer(text, deepSeek);

  await db.update(itemAnalysis).set({
    d1Policy: result.d1Policy,
    d3Market: result.d3Market,
    d4Tech: result.d4Tech,
    d5Business: result.d5Business,
    summaryZh: result.summaryZh,
    translationZh: result.translationZh,
    category: result.category,
  }).where(eq(itemAnalysis.itemId, itemId));
}

async function handleEmbedderJob(job: { data: PipelineJob }): Promise<void> {
  const db = getDb();
  const itemId = job.data.itemId;
  const [row] = await db.select({
    title: items.title,
    summaryZh: itemAnalysis.summaryZh,
  }).from(items)
    .innerJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id))
    .where(eq(items.id, itemId)).limit(1);

  if (!row) return;

  const embedding = await runEmbedder(row.title, row.summaryZh ?? row.title, qwen);
  await db.update(itemAnalysis).set({ embedding: JSON.stringify(embedding) as unknown as number[] }).where(eq(itemAnalysis.itemId, itemId));
}

async function handleClusterJob(job: { data: PipelineJob }): Promise<void> {
  const db = getDb();
  const itemId = job.data.itemId;
  const redis = createRedisConnection();

  const [row] = await db.select({
    embedding: itemAnalysis.embedding,
    itemId: itemAnalysis.itemId,
  }).from(itemAnalysis).where(eq(itemAnalysis.itemId, itemId)).limit(1);

  if (!row || !row.embedding) return;

  const embedding = Array.isArray(row.embedding) ? row.embedding : JSON.parse(row.embedding as unknown as string) as number[];

  const candidates = await db.select({
    clusterId: clusters.id,
    centroid: clusters.centroid,
  }).from(clusters)
    .where(sql`${clusters.centroid} IS NOT NULL`)
    .limit(100);

  const parsedCandidates = candidates.map((c) => ({
    clusterId: c.clusterId,
    centroid: (Array.isArray(c.centroid) ? c.centroid : JSON.parse(c.centroid as unknown as string)) as number[],
  }));

  let bestCluster: { clusterId: number; similarity: number } | null = null;
  for (const candidate of parsedCandidates) {
    const sim = cosineSimilarity(embedding, candidate.centroid);
    if (sim >= 0.85 && (!bestCluster || sim > bestCluster.similarity)) {
      bestCluster = { clusterId: candidate.clusterId, similarity: sim };
    }
  }

  if (bestCluster) {
    await db.insert(clusterItems).values({
      clusterId: bestCluster.clusterId,
      itemId,
      similarity: bestCluster.similarity,
    }).onConflictDoNothing();
  } else {
    await withClusterCreateLock(redis, async () => {
      const [newCluster] = await db.insert(clusters).values({
        centroid: JSON.stringify(embedding) as unknown as number[],
        leadItemId: itemId,
      }).returning({ id: clusters.id });

      if (newCluster) {
        await db.insert(clusterItems).values({
          clusterId: newCluster.id,
          itemId,
          similarity: 1.0,
        });
      }
    });
  }
}

async function handleCuratorJob(job: { data: PipelineJob }): Promise<void> {
  const db = getDb();
  const itemId = job.data.itemId;

  const [itemRow] = await db.select({
    sourceId: items.sourceId,
  }).from(items).where(eq(items.id, itemId)).limit(1);
  if (!itemRow) return;

  const [sourceRow] = await db.select({
    tier: sources.tier,
  }).from(sources).where(eq(sources.id, itemRow.sourceId)).limit(1);
  if (!sourceRow) return;

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
}

async function handleDailyJob(): Promise<void> {
  await runDailyGen(kimi);
  logger.info("daily report generated");
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function startWorker(): Promise<void> {
  const connection = createRedisConnection();

  qwen = createQwenClient();
  deepSeek = createDeepSeekClient();
  kimi = createKimiClient();

  logger.info("initializing workers...");

  const fetchWorker = new Worker<FetchSourceJob>(
    QUEUES.fetch,
    async (job) => {
      logger.info({ jobId: job.id, sourceId: job.data.sourceId }, "processing fetch job");
      await handleFetchJob(job);
    },
    { connection, concurrency: FETCH_CONCURRENCY },
  );

  const prefilterWorker = new Worker<PipelineJob>(
    QUEUES.prefilter,
    async (job) => {
      await handlePrefilterJob(job);
    },
    { connection, concurrency: 5 },
  );

  const nerWorker = new Worker<PipelineJob>(
    QUEUES.ner,
    async (job) => {
      await handleNerJob(job);
    },
    { connection, concurrency: 3 },
  );

  const scorerWorker = new Worker<PipelineJob>(
    QUEUES.scorer,
    async (job) => {
      await handleScorerJob(job);
    },
    { connection, concurrency: 3 },
  );

  const embedderWorker = new Worker<PipelineJob>(
    QUEUES.embedder,
    async (job) => {
      await handleEmbedderJob(job);
    },
    { connection, concurrency: 2 },
  );

  const clusterWorker = new Worker<PipelineJob>(
    QUEUES.cluster,
    async (job) => {
      await handleClusterJob(job);
    },
    { connection, concurrency: 2 },
  );

  const curatorWorker = new Worker<PipelineJob>(
    QUEUES.curator,
    async (job) => {
      await handleCuratorJob(job);
    },
    { connection, concurrency: 5 },
  );

  const dailyWorker = new Worker(
    QUEUES.daily,
    async () => {
      await handleDailyJob();
    },
    { connection, concurrency: 1 },
  );

  const allWorkers = [fetchWorker, prefilterWorker, nerWorker, scorerWorker, embedderWorker, clusterWorker, curatorWorker, dailyWorker];

  for (const w of allWorkers) {
    w.on("failed", (job, error) => {
      if (job) {
        logger.error({ jobId: job.id, queue: job.queueName, error: error.message }, "job failed");
      }
    });
    w.on("completed", (job) => {
      if (job) {
        logger.info({ jobId: job.id, queue: job.queueName }, "job completed");
      }
    });
  }

  const { Queue } = await import("bullmq");
  const fetchQueue = new Queue<FetchSourceJob>(QUEUES.fetch, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  await fetchQueue.add("schedule-fetch-sources", { sourceId: 0 }, {
    repeat: { pattern: FETCH_SCHEDULE_CRON, tz: FETCH_SCHEDULE_TZ },
    jobId: "schedule-fetch-sources",
  });

  const dailyQueue = new Queue(QUEUES.daily, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  await dailyQueue.add("schedule-daily-report", {}, {
    repeat: { pattern: DAILY_REPORT_SCHEDULE_CRON, tz: DAILY_REPORT_SCHEDULE_TZ },
    jobId: "schedule-daily-report",
  });

  const cleanupQueue = new Queue("fe:cleanup", { connection, defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 1 } });
  await cleanupQueue.add("schedule-cleanup", {}, {
    repeat: { pattern: CLEANUP_SCHEDULE_CRON, tz: CLEANUP_SCHEDULE_TZ },
    jobId: "schedule-cleanup",
  });

  const cleanupWorker = new Worker(
    "fe:cleanup",
    async () => {
      const result = await runCleanup();
      logger.info(result, "cleanup completed");
    },
    { connection, concurrency: 1 },
  );
  allWorkers.push(cleanupWorker);

  const quotesFetchQueue = new Queue<QuotesFetchJob>(QUEUE_QUOTES_FETCH, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  await scheduleQuotesFetchCron(quotesFetchQueue);

  const quotesFetchWorker = new Worker<QuotesFetchJob>(
    QUEUE_QUOTES_FETCH,
    async (job) => {
      if (job.data.sourceId === 0) {
        const count = await enqueueEnabledQuotesSources(getDb(), quotesFetchQueue);
        logger.info({ count }, "scheduled quotes-fetch cycle");
        return;
      }
      logger.info({ jobId: job.id, sourceId: job.data.sourceId }, "processing quotes-fetch job");
      await runQuotesFetch(job.data.sourceId);
    },
    { connection, concurrency: FETCH_CONCURRENCY },
  );
  allWorkers.push(quotesFetchWorker);

  logger.info("all workers and schedulers started");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down...");
    await Promise.all(allWorkers.map((w) => w.close()));
    if (playwrightPool) {
      await playwrightPool.close();
    }
    await connection.quit();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

export { workerName } from "./index";
