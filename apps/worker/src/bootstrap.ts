import { Worker } from "bullmq";

import { QUEUES, QUEUE_CLEANUP } from "@fe-radar/shared";
import { asRedisEval, setHostThrottleRedis } from "@fe-radar/core";
import { getDb } from "@fe-radar/db";
import { createQwenClient, createDeepSeekClient, createKimiClient } from "@fe-radar/llm";
import { closePlaywrightPool, getOrCreatePlaywrightPool } from "./lib/playwright-pool";

import type { BriefingGenJob, BriefingPushJob, FetchSourceJob, PipelineJob, QuotesFetchJob, WebsearchJob } from "./queues";
import { createRedisConnection, createWebsearchQueue, FETCH_SCHEDULE_CRON, FETCH_SCHEDULE_TZ, DAILY_REPORT_SCHEDULE_CRON, DAILY_REPORT_SCHEDULE_TZ, DEFAULT_JOB_OPTIONS, QUEUE_QUOTES_FETCH, QUEUE_BRIEFING_GEN, BRIEFING_GEN_SCHEDULE_CRON, BRIEFING_GEN_SCHEDULE_TZ, QUEUE_BRIEFING_PUSH, WEBSEARCH_SWEEP_SCHEDULE_CRON, WEBSEARCH_SWEEP_SCHEDULE_TZ, QUEUE_HEALTH_CHECK, HEALTH_CHECK_SCHEDULE_CRON, HEALTH_CHECK_SCHEDULE_TZ, getBriefingRepushId, isDailyRepushJob, isMinuteTickJob } from "./queues";
import { enqueueEnabledQuotesSources, scheduleQuotesFetchCron, scheduleBriefingPushCron, FETCH_CONCURRENCY } from "./scheduler";
import { runCleanup, CLEANUP_SCHEDULE_CRON, CLEANUP_SCHEDULE_TZ } from "./jobs/cleanup";
import { runQuotesFetch } from "./jobs/quotes-fetch";
import { runBriefingGen as runBriefingGenJob } from "./jobs/briefing-gen";
import { runBriefingPush, runScheduledBriefingPush } from "./jobs/briefing-push";
import { runManualDailyPush, runScheduledDailyPush } from "./jobs/daily-push";

import { logger, handlerContext, loadProjectCodes } from "./handlers/context";
import { handleFetchJob } from "./handlers/fetch";
import { handlePrefilterJob } from "./handlers/prefilter";
import { handleNerJob } from "./handlers/ner";
import { handleScorerJob } from "./handlers/scorer";
import { handleEmbedderJob } from "./handlers/embedder";
import { handleClusterJob } from "./handlers/cluster";
import { handleCuratorJob } from "./handlers/curator";
import { handleDailyJob } from "./handlers/daily";
import { handleWebsearchJob } from "./jobs/websearch";
import { runWebsearchSweep } from "./jobs/websearch-sweep";
import { runHealthCheck } from "./jobs/health-check";
import { handleDetailFetchJob } from "./jobs/detail-fetch";
import { startInternalHttpServer } from "./internal/http-server";
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
  /** T-CA-04: shutdown 只关一次全局 Playwright 池（禁止双重 close）。 */
  closePlaywrightPool: () => Promise<void>;
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
        await options.closePlaywrightPool();
        await options.connection.quit();
        options.logger.info({ signal }, "shutdown complete");
      })();

      return shutdownPromise;
    },
  };
}

export async function startWorker(): Promise<WorkerRuntime> {
  const connection = createRedisConnection();

  // T-CA-04 / design §3.4.2: worker 进程内同站闸统一接 Redis。必须经 asRedisEval
  // 严格 wrapper，禁止把 ioredis 实例当 RedisEvalLike 裸传（quota 存量裸 cast 不在本批次）。
  // MIRROR: scripts/sources-fetch-audit.ts + apps/worker/src/scripts/verify-sources.ts 同款桥接。
  // ioredis 的 eval 重载与 asRedisEval 的 (...unknown[]) 输入不结构兼容（参数逆变），
  // 这里只做参数形状桥接（全部转成合法 RedisValue）；数值返回校验仍由 asRedisEval 承担。
  setHostThrottleRedis(
    asRedisEval({
      eval: (...args: unknown[]) =>
        connection.eval(
          String(args[0]),
          Number(args[1]),
          ...args.slice(2).map((v) => (typeof v === "number" ? v : String(v)))
        )
    })
  );

  const heartbeat = startHeartbeat(connection);

  try {
    // T-CA-04: 预热全局 Playwright 池（getter 内部是生产路径唯一 launch 点）。
    // 失败只 warn 不 process.exit —— 首个 playwright 抓取时经 getter 懒重试。
    handlerContext.playwrightPool = await getOrCreatePlaywrightPool();
  } catch (err) {
    logger.warn({ err }, "playwright pool warmup failed; will retry lazily on first playwright fetch");
  }

  handlerContext.qwen = createQwenClient();
  handlerContext.deepSeek = createDeepSeekClient();
  handlerContext.kimi = createKimiClient();
  // T-SEC-09: 启动时预载项目代号字典（预热 loadProjectCodes 的 5min 缓存），
  // 防内部代号泄露给公网 LLM。pipeline handler 处理每个 job 时会重新调 loadProjectCodes()
  // 取缓存值，admin 新增代号最迟 5min 后生效，无需重启 worker。
  try {
    handlerContext.projectCodes = await loadProjectCodes();
  } catch (err) {
    logger.warn({ err }, "loadProjectCodes failed at boot; handlers will retry per job via loadProjectCodes()");
    handlerContext.projectCodes = [];
  }

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
      const result = await runBriefingGenJob({ now: job.data.briefingDate ? new Date(job.data.briefingDate) : undefined, force: job.data.force });
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
      // Explicit discriminant (T17a): minute-tick | daily-repush | briefing-repush.
      // Legacy { briefingId: 0 } still treated as minute-tick for scheduler compat.
      if (isMinuteTickJob(job.data)) {
        // Spec §5: sample wall clock once per tick; pass the same value to both gates.
        const now = new Date();
        try {
          const result = await runScheduledDailyPush({ now });
          logger.info(result, "daily-push tick completed");
        } catch (err) {
          logger.error({ err }, "daily-push tick failed");
        }
        try {
          // Same `now` sampled above — do not re-sample (T17b).
          const result = await runScheduledBriefingPush({ now });
          logger.info(result, "briefing-push tick completed");
        } catch (err) {
          logger.error({ err }, "briefing-push tick failed");
        }
        return;
      }

      if (isDailyRepushJob(job.data)) {
        logger.info(
          { jobId: job.id, reportDate: job.data.reportDate, trigger: job.data.trigger },
          "processing daily-repush job"
        );
        const result = await runManualDailyPush(job.data.reportDate);
        logger.info(result, "daily-repush completed");
        return;
      }

      const briefingId = getBriefingRepushId(job.data);
      if (briefingId == null) {
        logger.error({ jobId: job.id, data: job.data }, "briefing-push: unknown job payload");
        return;
      }
      // Manual briefing-only repush — explicit mode so CAS reclaim is allowed (T17b).
      logger.info({ jobId: job.id, briefingId, trigger: "manual" }, "processing briefing-push job");
      const result = await runBriefingPush(briefingId, { mode: "manual" });
      logger.info(result, "briefing-push completed");
    },
    { connection, concurrency: 1 },
  );
  allWorkers.push(briefingPushWorker);

  // v1.2 — websearch（NER 事件驱动）；T-UP-01 另加 06:30 兜底 sweep
  const websearchQueue = createWebsearchQueue(connection);
  allQueues.push(websearchQueue);
  await websearchQueue.add("schedule-websearch-sweep", {
    entityId: 0,
    entityName: "websearch-sweep",
    itemId: 0,
  }, {
    repeat: { pattern: WEBSEARCH_SWEEP_SCHEDULE_CRON, tz: WEBSEARCH_SWEEP_SCHEDULE_TZ },
    jobId: "schedule-websearch-sweep",
  });

  const websearchWorker = new Worker<WebsearchJob>(
    QUEUES.websearch,
    async (job) => {
      if (job.name === "schedule-websearch-sweep") {
        try {
          await runWebsearchSweep();
        } catch (err) {
          logger.error({ err }, "websearch sweep failed");
        }
        return;
      }
      logger.info({ jobId: job.id, entityId: job.data.entityId, entityName: job.data.entityName }, "processing websearch job");
      await handleWebsearchJob(job);
    },
    { connection, concurrency: 2 },
  );
  allWorkers.push(websearchWorker);

  // T-CA-05：detail-fetch 必须进 allWorkers / allQueues，并注入 curator。
  const detailFetchQueue = new Queue<{ itemId: number }>(QUEUES.detailFetch, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  allQueues.push(detailFetchQueue);
  const detailFetchWorker = new Worker<{ itemId: number }>(
    QUEUES.detailFetch,
    async (job) => {
      await handleDetailFetchJob(job.data.itemId);
    },
    { connection, concurrency: 2 },
  );
  allWorkers.push(detailFetchWorker);
  handlerContext.detailFetchQueue = detailFetchQueue;

  const healthCheckQueue = new Queue(QUEUE_HEALTH_CHECK, {
    connection,
    defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 1 },
  });
  allQueues.push(healthCheckQueue);
  await healthCheckQueue.add("schedule-health-check", {}, {
    repeat: { pattern: HEALTH_CHECK_SCHEDULE_CRON, tz: HEALTH_CHECK_SCHEDULE_TZ },
    jobId: "schedule-health-check",
  });

  const healthCheckWorker = new Worker(
    QUEUE_HEALTH_CHECK,
    async () => {
      try {
        await runHealthCheck();
      } catch (err) {
        logger.error({ err }, "health check failed");
      }
    },
    { connection, concurrency: 1 },
  );
  allWorkers.push(healthCheckWorker);

  // T-CA-05：内网 HTTP。listen 失败不 exit（http-server 已吞 error）。
  // SERVICE_TOKEN_WORKER_FILE 缺/空由 startInternalHttpServer 自己 warn。
  const internalHttp = await startInternalHttpServer();

  logger.info("all workers and schedulers started");

  return createWorkerRuntime({
    workers: allWorkers,
    queues: allQueues,
    connection,
    closePlaywrightPool,
    logger,
    onShutdown: async () => {
      await internalHttp.shutdown("runtime");
      await heartbeat.stop();
    },
  });
}
