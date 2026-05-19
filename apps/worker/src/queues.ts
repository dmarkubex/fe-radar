import { FlowProducer, Queue } from "bullmq";
import IORedis from "ioredis";
import { QUEUES } from "@fe-radar/shared";

export interface FetchSourceJob {
  sourceId: number;
}

export interface PipelineJob {
  itemId: number;
}

export const PIPELINE_STAGE_ORDER = ["fetch", "prefilter", "ner", "scorer", "embedder", "cluster", "curator"] as const;
export type PipelineStage = (typeof PIPELINE_STAGE_ORDER)[number];

export interface PipelineQueues {
  fetch: Queue<FetchSourceJob>;
  prefilter: Queue<PipelineJob>;
  ner: Queue<PipelineJob>;
  scorer: Queue<PipelineJob>;
  embedder: Queue<PipelineJob>;
  cluster: Queue<PipelineJob>;
  curator: Queue<PipelineJob>;
  daily: Queue<Record<string, never>>;
}

export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: "exponential" as const,
    delay: 200
  },
  removeOnComplete: 1000,
  removeOnFail: 5000
};

export function createRedisConnection(redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379"): IORedis {
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

export function createFetchQueue(connection = createRedisConnection()): Queue<FetchSourceJob> {
  return new Queue<FetchSourceJob>(QUEUES.fetch, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS
  });
}

export function createPipelineQueues(connection = createRedisConnection()): PipelineQueues {
  return {
    fetch: createFetchQueue(connection),
    prefilter: createStageQueue("prefilter", connection),
    ner: createStageQueue("ner", connection),
    scorer: createStageQueue("scorer", connection),
    embedder: createStageQueue("embedder", connection),
    cluster: createStageQueue("cluster", connection),
    curator: createStageQueue("curator", connection),
    daily: new Queue<Record<string, never>>(QUEUES.daily, {
      connection,
      defaultJobOptions: {
        ...DEFAULT_JOB_OPTIONS,
        attempts: 3,
        backoff: { type: "fixed", delay: 30 * 60 * 1000 }
      }
    })
  };
}

export function createStageQueue(stage: Exclude<PipelineStage, "fetch">, connection = createRedisConnection()): Queue<PipelineJob> {
  return new Queue<PipelineJob>(QUEUES[stage], {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS
  });
}

export function createFlowProducer(connection = createRedisConnection()): FlowProducer {
  return new FlowProducer({ connection });
}

export const FETCH_SCHEDULE_CRON = "0 */6 * * *";
export const FETCH_SCHEDULE_TZ = "Asia/Shanghai";
export const DAILY_REPORT_SCHEDULE_CRON = "0 8 * * *";
export const DAILY_REPORT_SCHEDULE_TZ = "Asia/Shanghai";

export const QUEUE_QUOTES_FETCH = "fe:quotes-fetch";
export const QUOTES_FETCH_SCHEDULE_CRON = "0 30 15 * * 1-5";
export const QUOTES_FETCH_SCHEDULE_TZ = "Asia/Shanghai";

export interface QuotesFetchJob {
  sourceId: number;
}

export function createQuotesFetchQueue(connection = createRedisConnection()): Queue<QuotesFetchJob> {
  return new Queue<QuotesFetchJob>(QUEUE_QUOTES_FETCH, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS
  });
}

export const QUEUE_BRIEFING_GEN = "fe:briefing-gen";
export const BRIEFING_GEN_SCHEDULE_CRON = "0 0 16 * * 1-5";
export const BRIEFING_GEN_SCHEDULE_TZ = "Asia/Shanghai";

export interface BriefingGenJob {
  briefingDate?: string; // YYYY-MM-DD; omit to use today
}

export function createBriefingGenQueue(connection = createRedisConnection()): Queue<BriefingGenJob> {
  return new Queue<BriefingGenJob>(QUEUE_BRIEFING_GEN, {
    connection,
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      attempts: 1 // briefing-gen manages its own retries internally
    }
  });
}

export const QUEUE_BRIEFING_PUSH = "fe:briefing-push";
export const BRIEFING_PUSH_SCHEDULE_CRON = "0 5 16 * * 1-5";
export const BRIEFING_PUSH_SCHEDULE_TZ = "Asia/Shanghai";

export interface BriefingPushJob {
  briefingId: number;
}

export function createBriefingPushQueue(connection = createRedisConnection()): Queue<BriefingPushJob> {
  return new Queue<BriefingPushJob>(QUEUE_BRIEFING_PUSH, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS
  });
}
