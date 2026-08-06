import { describe, expect, it, vi } from "vitest";
import {
  BRIEFING_PUSH_LEGACY_CRON,
  BRIEFING_PUSH_SCHEDULE_CRON,
  BRIEFING_PUSH_SCHEDULE_TZ,
  FETCH_SCHEDULE_CRON,
  FETCH_SCHEDULE_TZ,
} from "../queues";
import {
  enqueueEnabledSources,
  removeLegacyBriefingPushRepeat,
  scheduleBriefingPushCron,
  shouldDisableSource,
} from "../scheduler";
import { enqueueStartupFetch, registerRepeatJobs, shouldFetchOnStartup, type SchedulerRepeatQueues } from "../scheduler-main";

describe("scheduler", () => {
  it("uses 6h Asia/Shanghai cron", () => {
    expect(FETCH_SCHEDULE_CRON).toBe("0 */6 * * *");
    expect(FETCH_SCHEDULE_TZ).toBe("Asia/Shanghai");
  });

  it("disables source after 7 failed days", () => {
    expect(shouldDisableSource({ failCount: 6 })).toBe(false);
    expect(shouldDisableSource({ failCount: 7 })).toBe(true);
  });

  it("enqueues enabled non-quotes sources", async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            where: vi.fn(async () => [
              { id: 1, fetcherType: "rss" },
              { id: 2, fetcherType: "playwright" },
              { id: 3, fetcherType: "quotes" }
            ])
          }))
        }))
      }))
    };
    const queue = { add: vi.fn(async () => undefined) };
    await expect(enqueueEnabledSources(db as never, queue as never)).resolves.toBe(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
    const calls = queue.add.mock.calls as unknown as Array<[string, { sourceId: number }, { jobId: string }]>;
    expect(calls[0]?.[2].jobId).toMatch(/^fetch-source-1-/);
    expect(calls[1]?.[2].jobId).toMatch(/^fetch-source-2-/);
    expect(calls.map((call) => call[1].sourceId)).not.toContain(3);
    expect(calls[0]?.[2].jobId).not.toBe("fetch-source-1");
  });

  it("registers all repeat jobs from the scheduler main entrypoint", async () => {
    const makeQueue = () => ({
      add: vi.fn(async () => undefined),
      removeRepeatable: vi.fn(async () => true),
      close: vi.fn(async () => undefined),
    });
    const queues = {
      fetch: makeQueue(),
      daily: makeQueue(),
      cleanup: makeQueue(),
      quotesFetch: makeQueue(),
      briefingGen: makeQueue(),
      briefingPush: makeQueue(),
    } as unknown as SchedulerRepeatQueues;
    const logger = { info: vi.fn(), error: vi.fn() };

    await registerRepeatJobs(queues, logger);

    expect(queues.fetch.add).toHaveBeenCalledWith(
      "schedule-fetch-sources",
      { sourceId: 0 },
      expect.objectContaining({ jobId: "schedule-fetch-sources" })
    );
    expect(queues.daily.add).toHaveBeenCalledWith(
      "schedule-daily-report",
      {},
      expect.objectContaining({ jobId: "schedule-daily-report" })
    );
    expect(queues.cleanup.add).toHaveBeenCalledWith(
      "schedule-cleanup",
      {},
      expect.objectContaining({ jobId: "schedule-cleanup" })
    );
    expect(queues.quotesFetch.add).toHaveBeenCalledWith(
      "schedule-quotes-fetch",
      { sourceId: 0 },
      expect.objectContaining({ jobId: "schedule-quotes-fetch" })
    );
    expect(queues.briefingGen.add).toHaveBeenCalledWith(
      "schedule-briefing-gen",
      {},
      expect.objectContaining({ jobId: "schedule-briefing-gen" })
    );
    // Gate-B: legacy 16:05 removed before minute tick registration (scheduler-main path)
    expect(queues.briefingPush.removeRepeatable).toHaveBeenCalledWith(
      "schedule-briefing-push",
      { pattern: BRIEFING_PUSH_LEGACY_CRON, tz: BRIEFING_PUSH_SCHEDULE_TZ },
      "schedule-briefing-push"
    );
    expect(queues.briefingPush.add).toHaveBeenCalledWith(
      "schedule-briefing-push",
      { briefingId: 0 },
      expect.objectContaining({
        jobId: "schedule-briefing-push",
        repeat: expect.objectContaining({ pattern: BRIEFING_PUSH_SCHEDULE_CRON }),
      })
    );
    expect(BRIEFING_PUSH_SCHEDULE_CRON).toBe("0 * * * * *");
    expect(BRIEFING_PUSH_LEGACY_CRON).toBe("0 5 16 * * 1-5");
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ queue: "fe-fetch" }), "registered repeat job");
  });

  it("scheduleBriefingPushCron removes legacy repeat before adding minute tick", async () => {
    const queue = {
      add: vi.fn(async () => undefined),
      removeRepeatable: vi.fn(async () => true),
    };
    await scheduleBriefingPushCron(queue as never);
    expect(queue.removeRepeatable).toHaveBeenCalledWith(
      "schedule-briefing-push",
      { pattern: BRIEFING_PUSH_LEGACY_CRON, tz: BRIEFING_PUSH_SCHEDULE_TZ },
      "schedule-briefing-push"
    );
    expect(queue.add).toHaveBeenCalledWith(
      "schedule-briefing-push",
      { briefingId: 0 },
      expect.objectContaining({
        jobId: "schedule-briefing-push",
        repeat: { pattern: BRIEFING_PUSH_SCHEDULE_CRON, tz: BRIEFING_PUSH_SCHEDULE_TZ },
      })
    );
    // remove before add
    const removeOrder = queue.removeRepeatable.mock.invocationCallOrder[0] ?? 0;
    const addOrder = queue.add.mock.invocationCallOrder[0] ?? 0;
    expect(removeOrder).toBeLessThan(addOrder);
  });

  it("removeLegacyBriefingPushRepeat swallows missing-repeat errors", async () => {
    const queue = {
      removeRepeatable: vi.fn(async () => {
        throw new Error("not found");
      }),
    };
    await expect(removeLegacyBriefingPushRepeat(queue as never)).resolves.toBeUndefined();
  });

  it("parses the startup fetch switch conservatively", () => {
    expect(shouldFetchOnStartup("true")).toBe(true);
    expect(shouldFetchOnStartup("1")).toBe(true);
    expect(shouldFetchOnStartup("yes")).toBe(true);
    expect(shouldFetchOnStartup("false")).toBe(false);
    expect(shouldFetchOnStartup(undefined)).toBe(false);
  });

  it("enqueues one immediate fetch cycle when startup fetch is enabled", async () => {
    const queue = { add: vi.fn(async () => undefined) };
    const logger = { info: vi.fn(), error: vi.fn() };

    await enqueueStartupFetch({ fetch: queue } as unknown as Pick<SchedulerRepeatQueues, "fetch">, logger);

    expect(queue.add).toHaveBeenCalledWith(
      "schedule-fetch-sources",
      { sourceId: 0 },
      expect.objectContaining({ jobId: expect.stringMatching(/^startup-fetch-sources-\d+$/) })
    );
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ queue: "fe-fetch" }), "enqueued startup fetch job");
  });
});
