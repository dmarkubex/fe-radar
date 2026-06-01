import { Worker } from "bullmq";

import { QUEUES, QUEUE_CLEANUP } from "@fe-radar/shared";
import { getDb } from "@fe-radar/db";
import { createQwenClient, createDeepSeekClient, createKimiClient } from "@fe-radar/llm";

import type { BriefingGenJob, BriefingPushJob, FetchSourceJob, PipelineJob, QuotesFetchJob } from "./queues";
import { createRedisConnection, FETCH_SCHEDULE_CRON, FETCH_SCHEDULE_TZ, DAILY_REPORT_SCHEDULE_CRON, DAILY_REPORT_SCHEDULE_TZ, DEFAULT_JOB_OPTIONS, QUEUE_QUOTES_FETCH, QUEUE_BRIEFING_GEN, BRIEFING_GEN_SCHEDULE_CRON, BRIEFING_GEN_SCHEDULE_TZ, QUEUE_BRIEFING_PUSH } from "./queues";
import { enqueueEnabledQuotesSources, scheduleQuotesFetchCron, scheduleBriefingPushCron, FETCH_CONCURRENCY } from "./scheduler";
import { runCleanup, CLEANUP_SCHEDULE_CRON, CLEANUP_SCHEDULE_TZ } from "./jobs/cleanup";
import { runQuotesFetch } from "./jobs/quotes-fetch";
import { runBriefingGen as runBriefingGenJob } from "./jobs/briefing-gen";
import { runBriefingPush, scheduleLatestBriefingPush } from "./jobs/briefing-push";

import { logger, handlerContext } from "./handlers/context";
import { handleFetchJob } from "./handlers/fetch";
import { handlePrefilterJob } from "./handlers/prefilter";
import { handleNerJob } from "./handlers/ner";
import { handleScorerJob } from "./handlers/scorer";
import { handleEmbedderJob } from "./handlers/embedder";
import { handleClusterJob } from "./handlers/cluster";
import { handleCuratorJob } from "./handlers/curator";
import { handleDailyJob } from "./handlers/daily";
import { startHeartbeat } from "./heartbeat";

export interface WorkerRuntime {
  shutdown(signal: string): Promise<void>;
}

interface ShutdownLogger {
  info(obj: object, msg: string): void;
}

interface CloseableResource {
  close(): Promise<unknown>;
}

interface RedisConnection {
  quit(): Promise<unknown>;
}

interface WorkerRuntimeOptions {
  workers: CloseableResource[];
  queues: CloseableResource[];
  connection: RedisConnection;
  getPlaywrightPool: () => CloseableResource | undefined;
  logger: ShutdownLogger;
  onShutdown?: () => void | Promise<void>;
}

export function createWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  let shutdownPromise: Promise<void> | null = null;

  return {
    shutdown(signal: string): Promise<void> {
      shutdownPromise ??= (async () => {
        options.logger.info({ signal }, "shutting down...");
        await options.onShutdown?.();
        await Promise.all(options.workers.map((w) => w.close()));
        await Promise.all(options.queues.map((q) => q.close()));
        const pool = options.getPlaywrightPool();
        if (pool) {
          await pool.close();
        }
        await options.connection.quit();
        options.logger.info({ signal }, "shutdown complete");
      })();

      return shutdownPromise;
    },
  };
}

export async function startWorker(): Promise<WorkerRuntime> {
  const connection = createRedisConnection();

  const heartbeat = startHeartbeat(connection);

  handlerContext.qwen = createQwenClient();
  handlerContext.deepSeek = createDeepSeekClient();
  handlerContext.kimi = createKimiClient();

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
  const allQueues: CloseableResource[] = [fetchQueue];
  await fetchQueue.add("schedule-fetch-sources", { sourceId: 0 }, {
    repeat: { pattern: FETCH_SCHEDULE_CRON, tz: FETCH_SCHEDULE_TZ },
    jobId: "schedule-fetch-sources",
  });

  const dailyQueue = new Queue(QUEUES.daily, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  allQueues.push(dailyQueue);
  await dailyQueue.add("schedule-daily-report", {}, {
    repeat: { pattern: DAILY_REPORT_SCHEDULE_CRON, tz: DAILY_REPORT_SCHEDULE_TZ },
    jobId: "schedule-daily-report",
  });

  const cleanupQueue = new Queue(QUEUE_CLEANUP, { connection, defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 1 } });
  allQueues.push(cleanupQueue);
  await cleanupQueue.add("schedule-cleanup", {}, {
    repeat: { pattern: CLEANUP_SCHEDULE_CRON, tz: CLEANUP_SCHEDULE_TZ },
    jobId: "schedule-cleanup",
  });

  const cleanupWorker = new Worker(
    QUEUE_CLEANUP,
    async () => {
      const result = await runCleanup();
      logger.info(result, "cleanup completed");
    },
    { connection, concurrency: 1 },
  );
  allWorkers.push(cleanupWorker);

  const quotesFetchQueue = new Queue<QuotesFetchJob>(QUEUE_QUOTES_FETCH, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  allQueues.push(quotesFetchQueue);
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

  const briefingGenQueue = new Queue<BriefingGenJob>(QUEUE_BRIEFING_GEN, {
    connection,
    defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 1 }
  });
  allQueues.push(briefingGenQueue);
  await briefingGenQueue.add("schedule-briefing-gen", {}, {
    repeat: { pattern: BRIEFING_GEN_SCHEDULE_CRON, tz: BRIEFING_GEN_SCHEDULE_TZ },
    jobId: "schedule-briefing-gen",
  });

  const briefingGenWorker = new Worker<BriefingGenJob>(
    QUEUE_BRIEFING_GEN,
    async (job) => {
      logger.info({ jobId: job.id }, "processing briefing-gen job");
      const result = await runBriefingGenJob({ now: job.data.briefingDate ? new Date(job.data.briefingDate) : undefined });
      logger.info(result, "briefing-gen completed");
    },
    { connection, concurrency: 1 },
  );
  allWorkers.push(briefingGenWorker);

  const briefingPushQueue = new Queue<BriefingPushJob>(QUEUE_BRIEFING_PUSH, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  allQueues.push(briefingPushQueue);
  await scheduleBriefingPushCron(briefingPushQueue);

  const briefingPushWorker = new Worker<BriefingPushJob>(
    QUEUE_BRIEFING_PUSH,
    async (job) => {
      if (job.data.briefingId === 0) {
        // cron trigger: find today's briefing and re-enqueue with real id
        const briefingId = await scheduleLatestBriefingPush();
        if (briefingId !== null) {
          await briefingPushQueue.add("briefing-push", { briefingId }, {
            jobId: `briefing-push-${briefingId}`,
          });
          logger.info({ briefingId }, "briefing-push cron: enqueued push job");
        }
        return;
      }
      logger.info({ jobId: job.id, briefingId: job.data.briefingId }, "processing briefing-push job");
      const result = await runBriefingPush(job.data.briefingId);
      logger.info(result, "briefing-push completed");
    },
    { connection, concurrency: 1 },
  );
  allWorkers.push(briefingPushWorker);

  logger.info("all workers and schedulers started");

  return createWorkerRuntime({
    workers: allWorkers,
    queues: allQueues,
    connection,
    getPlaywrightPool: () => handlerContext.playwrightPool,
    logger,
    onShutdown: async () => {
      await heartbeat.stop();
    },
  });
}
