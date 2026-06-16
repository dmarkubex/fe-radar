import { pathToFileURL } from "node:url";
import { Queue } from "bullmq";
import { createLogger, QUEUE_CLEANUP, QUEUES } from "@fe-radar/shared";

import { CLEANUP_SCHEDULE_CRON, CLEANUP_SCHEDULE_TZ } from "./jobs/cleanup";
import {
  BRIEFING_GEN_SCHEDULE_CRON,
  BRIEFING_GEN_SCHEDULE_TZ,
  BRIEFING_PUSH_SCHEDULE_CRON,
  BRIEFING_PUSH_SCHEDULE_TZ,
  DAILY_REPORT_SCHEDULE_CRON,
  DAILY_REPORT_SCHEDULE_TZ,
  DEFAULT_JOB_OPTIONS,
  FETCH_SCHEDULE_CRON,
  FETCH_SCHEDULE_TZ,
  QUEUE_BRIEFING_GEN,
  QUEUE_BRIEFING_PUSH,
  QUEUE_QUOTES_FETCH,
  QUOTES_FETCH_SCHEDULE_CRON,
  QUOTES_FETCH_SCHEDULE_TZ,
  createRedisConnection,
} from "./queues";

import type {
  BriefingGenJob,
  BriefingPushJob,
  FetchSourceJob,
  QuotesFetchJob,
} from "./queues";

const schedulerLogger = createLogger({ service: "scheduler" });

interface SchedulerLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

interface RepeatQueue<T> {
  add(
    name: string,
    data: T,
    options: {
      repeat: { pattern: string; tz: string };
      jobId: string;
    }
  ): Promise<unknown>;
  close(): Promise<unknown>;
}

type RedisConnection = ReturnType<typeof createRedisConnection>;

export interface SchedulerRepeatQueues {
  fetch: RepeatQueue<FetchSourceJob>;
  daily: RepeatQueue<Record<string, never>>;
  cleanup: RepeatQueue<Record<string, never>>;
  quotesFetch: RepeatQueue<QuotesFetchJob>;
  briefingGen: RepeatQueue<BriefingGenJob>;
  briefingPush: RepeatQueue<BriefingPushJob>;
}

export interface SchedulerRuntime {
  shutdown(signal: string): Promise<void>;
}

export function createSchedulerQueues(connection = createRedisConnection()): SchedulerRepeatQueues {
  return {
    fetch: new Queue<FetchSourceJob>(QUEUES.fetch, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    daily: new Queue<Record<string, never>>(QUEUES.daily, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    cleanup: new Queue<Record<string, never>>(QUEUE_CLEANUP, {
      connection,
      defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 1 },
    }),
    quotesFetch: new Queue<QuotesFetchJob>(QUEUE_QUOTES_FETCH, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    briefingGen: new Queue<BriefingGenJob>(QUEUE_BRIEFING_GEN, {
      connection,
      defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 1 },
    }),
    briefingPush: new Queue<BriefingPushJob>(QUEUE_BRIEFING_PUSH, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
  };
}

export async function registerRepeatJobs(
  queues: SchedulerRepeatQueues,
  logger: SchedulerLogger = schedulerLogger
): Promise<void> {
  await queues.fetch.add("schedule-fetch-sources", { sourceId: 0 }, {
    repeat: { pattern: FETCH_SCHEDULE_CRON, tz: FETCH_SCHEDULE_TZ },
    jobId: "schedule-fetch-sources",
  });
  logger.info({ queue: QUEUES.fetch, pattern: FETCH_SCHEDULE_CRON, tz: FETCH_SCHEDULE_TZ }, "registered repeat job");

  await queues.daily.add("schedule-daily-report", {}, {
    repeat: { pattern: DAILY_REPORT_SCHEDULE_CRON, tz: DAILY_REPORT_SCHEDULE_TZ },
    jobId: "schedule-daily-report",
  });
  logger.info({ queue: QUEUES.daily, pattern: DAILY_REPORT_SCHEDULE_CRON, tz: DAILY_REPORT_SCHEDULE_TZ }, "registered repeat job");

  await queues.cleanup.add("schedule-cleanup", {}, {
    repeat: { pattern: CLEANUP_SCHEDULE_CRON, tz: CLEANUP_SCHEDULE_TZ },
    jobId: "schedule-cleanup",
  });
  logger.info({ queue: QUEUE_CLEANUP, pattern: CLEANUP_SCHEDULE_CRON, tz: CLEANUP_SCHEDULE_TZ }, "registered repeat job");

  await queues.quotesFetch.add("schedule-quotes-fetch", { sourceId: 0 }, {
    repeat: { pattern: QUOTES_FETCH_SCHEDULE_CRON, tz: QUOTES_FETCH_SCHEDULE_TZ },
    jobId: "schedule-quotes-fetch",
  });
  logger.info({ queue: QUEUE_QUOTES_FETCH, pattern: QUOTES_FETCH_SCHEDULE_CRON, tz: QUOTES_FETCH_SCHEDULE_TZ }, "registered repeat job");

  await queues.briefingGen.add("schedule-briefing-gen", {}, {
    repeat: { pattern: BRIEFING_GEN_SCHEDULE_CRON, tz: BRIEFING_GEN_SCHEDULE_TZ },
    jobId: "schedule-briefing-gen",
  });
  logger.info({ queue: QUEUE_BRIEFING_GEN, pattern: BRIEFING_GEN_SCHEDULE_CRON, tz: BRIEFING_GEN_SCHEDULE_TZ }, "registered repeat job");

  await queues.briefingPush.add("schedule-briefing-push", { briefingId: 0 }, {
    repeat: { pattern: BRIEFING_PUSH_SCHEDULE_CRON, tz: BRIEFING_PUSH_SCHEDULE_TZ },
    jobId: "schedule-briefing-push",
  });
  logger.info({ queue: QUEUE_BRIEFING_PUSH, pattern: BRIEFING_PUSH_SCHEDULE_CRON, tz: BRIEFING_PUSH_SCHEDULE_TZ }, "registered repeat job");
}

interface SchedulerOptions {
  connection?: RedisConnection;
  queues?: SchedulerRepeatQueues;
  logger?: SchedulerLogger;
  keepAlive?: boolean;
}

export async function startScheduler(options: SchedulerOptions = {}): Promise<SchedulerRuntime> {
  const logger = options.logger ?? schedulerLogger;
  const connection = options.connection ?? createRedisConnection();
  const queues = options.queues ?? createSchedulerQueues(connection);
  const keepAlive = options.keepAlive ?? true;
  let keepAliveTimer: NodeJS.Timeout | undefined;
  let shutdownPromise: Promise<void> | null = null;

  try {
    await registerRepeatJobs(queues, logger);
    if (keepAlive) {
      keepAliveTimer = setInterval(() => undefined, 60 * 60 * 1000);
    }
    logger.info({ keepAlive }, "scheduler started; repeat jobs registered");
  } catch (error) {
    await Promise.all(Object.values(queues).map((queue) => queue.close().catch(() => undefined)));
    await connection.quit().catch(() => undefined);
    throw error;
  }

  return {
    shutdown(signal: string): Promise<void> {
      shutdownPromise ??= (async () => {
        logger.info({ signal }, "scheduler shutdown signal received");
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer);
        }
        await Promise.all(Object.values(queues).map((queue) => queue.close()));
        await connection.quit();
        logger.info({ signal }, "scheduler shutdown complete");
      })();

      return shutdownPromise;
    },
  };
}

function isCliEntrypoint(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isCliEntrypoint()) {
  const schedulerStartup = startScheduler();

  function shutdown(signal: "SIGTERM" | "SIGINT"): void {
    void schedulerStartup
      .then((runtime) => runtime.shutdown(signal))
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        schedulerLogger.error({ err, signal }, "scheduler graceful shutdown failed");
        process.exit(1);
      });
  }

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  schedulerStartup.catch((err: unknown) => {
    schedulerLogger.error({ err }, "scheduler fatal startup error");
    process.exit(1);
  });
}
