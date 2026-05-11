import type { SourceRecord } from "@fe-radar/db";
import { listSources, markSourceFailure, type DbClient } from "@fe-radar/db";
import type { Queue } from "bullmq";
import type { FetchSourceJob } from "./queues";
import { FETCH_SCHEDULE_CRON, FETCH_SCHEDULE_TZ } from "./queues";

export const FETCH_CONCURRENCY = 5;
export const DISABLE_AFTER_FAIL_DAYS = 7;

export async function enqueueEnabledSources(db: DbClient, queue: Queue<FetchSourceJob>): Promise<number> {
  const enabledSources = await listSources(db, { enabled: true });
  await Promise.all(
    enabledSources.map((source) =>
      queue.add("fetch-source", { sourceId: source.id }, {
        jobId: `fetch-source:${source.id}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 200 }
      })
    )
  );
  return enabledSources.length;
}

export async function scheduleFetchCron(queue: Queue<FetchSourceJob>): Promise<void> {
  // Parsed by BullMQ with Asia/Shanghai container TZ.
  await queue.add("schedule-fetch-sources", { sourceId: 0 }, {
    repeat: {
      pattern: FETCH_SCHEDULE_CRON,
      tz: FETCH_SCHEDULE_TZ
    },
    jobId: "schedule-fetch-sources"
  });
}

export function shouldDisableSource(source: Pick<SourceRecord, "failCount">): boolean {
  return source.failCount >= DISABLE_AFTER_FAIL_DAYS;
}

export async function recordSourceFailure(db: DbClient, source: Pick<SourceRecord, "id" | "failCount">): Promise<void> {
  const nextFailCount = source.failCount + 1;
  await markSourceFailure(db, source.id, nextFailCount, nextFailCount >= DISABLE_AFTER_FAIL_DAYS);
}
