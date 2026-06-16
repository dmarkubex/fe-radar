import { randomUUID } from "node:crypto";
import type { SourceRecord } from "@fe-radar/db";
import { listSources, markSourceFailure, type DbClient } from "@fe-radar/db";
import type { Queue } from "bullmq";
import type { BriefingPushJob, FetchSourceJob, QuotesFetchJob } from "./queues";
import { BRIEFING_PUSH_SCHEDULE_CRON, BRIEFING_PUSH_SCHEDULE_TZ, FETCH_SCHEDULE_CRON, FETCH_SCHEDULE_TZ, QUOTES_FETCH_SCHEDULE_CRON, QUOTES_FETCH_SCHEDULE_TZ } from "./queues";

export const FETCH_CONCURRENCY = 5;
export const DISABLE_AFTER_FAIL_DAYS = 7;

export async function enqueueEnabledSources(db: DbClient, queue: Queue<FetchSourceJob>): Promise<number> {
  const enabledSources = await listSources(db, { enabled: true });
  const newsSources = enabledSources.filter((source) => source.fetcherType !== "quotes");
  const batchId = randomUUID();
  await Promise.all(
    newsSources.map((source) =>
      queue.add("fetch-source", { sourceId: source.id }, {
        jobId: `fetch-source-${source.id}-${batchId}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 200 }
      })
    )
  );
  return newsSources.length;
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

export async function recordSourceFailure(
  db: DbClient,
  source: Pick<SourceRecord, "id" | "failCount">,
  errorMessage?: string
): Promise<void> {
  const nextFailCount = source.failCount + 1;
  await markSourceFailure(db, source.id, nextFailCount, nextFailCount >= DISABLE_AFTER_FAIL_DAYS, errorMessage ?? null);
}

export async function enqueueEnabledQuotesSources(
  db: DbClient,
  queue: Queue<QuotesFetchJob>
): Promise<number> {
  const enabledSources = await listSources(db, { enabled: true });
  const quotesSources = enabledSources.filter((s) => s.fetcherType === "quotes");
  const batchId = randomUUID();
  await Promise.all(
    quotesSources.map((source) =>
      queue.add("quotes-fetch", { sourceId: source.id }, {
        jobId: `quotes-fetch-${source.id}-${batchId}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 200 }
      })
    )
  );
  return quotesSources.length;
}

export async function scheduleQuotesFetchCron(queue: Queue<QuotesFetchJob>): Promise<void> {
  // 工作日 15:30 Asia/Shanghai (cron seconds syntax: 0 30 15 * * 1-5)
  await queue.add("schedule-quotes-fetch", { sourceId: 0 }, {
    repeat: {
      pattern: QUOTES_FETCH_SCHEDULE_CRON,
      tz: QUOTES_FETCH_SCHEDULE_TZ
    },
    jobId: "schedule-quotes-fetch"
  });
}

export async function scheduleBriefingPushCron(queue: Queue<BriefingPushJob>): Promise<void> {
  // 工作日 16:05 Asia/Shanghai (cron seconds syntax: 0 5 16 * * 1-5)
  await queue.add("schedule-briefing-push", { briefingId: 0 }, {
    repeat: {
      pattern: BRIEFING_PUSH_SCHEDULE_CRON,
      tz: BRIEFING_PUSH_SCHEDULE_TZ
    },
    jobId: "schedule-briefing-push"
  });
}
