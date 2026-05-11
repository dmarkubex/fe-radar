import { Queue } from "bullmq";
import IORedis from "ioredis";
import { QUEUES } from "@fe-radar/shared";

export interface FetchSourceJob {
  sourceId: number;
}

export function createRedisConnection(redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379"): IORedis {
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

export function createFetchQueue(connection = createRedisConnection()): Queue<FetchSourceJob> {
  return new Queue<FetchSourceJob>(QUEUES.fetch, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 200
      },
      removeOnComplete: 1000,
      removeOnFail: 5000
    }
  });
}

export const FETCH_SCHEDULE_CRON = "0 */6 * * *";
export const FETCH_SCHEDULE_TZ = "Asia/Shanghai";
