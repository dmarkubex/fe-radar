import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import type { DailyInputItem } from "../daily-gen";
import {
  buildHealthAlertCard,
  OPS_ALERT_NO_TARGET,
  runHealthCheck
} from "../health-check";
import { HEALTH_CHECK_SCHEDULE_CRON, HEALTH_CHECK_SCHEDULE_TZ } from "../../queues";

const CHECK_TZ = "Asia/Shanghai";

const OPS_TARGET = {
  webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=test",
  signSecret: "test-secret"
};

function curatedItems(n: number): DailyInputItem[] {
  return Array.from({ length: n }, (_, index) => ({
    title: `item-${index}`,
    sourceName: "source",
    category: "公司与资本",
    summaryZh: "摘要",
    scoredAt: new Date("2026-08-18T08:00:00+08:00"),
    publishedAt: new Date("2026-08-18T08:00:00+08:00")
  }));
}

function makeThenableChain(resolveValue: unknown) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(resolveValue));
  chain.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise.resolve(resolveValue).then(onFulfilled, onRejected);
  return chain;
}

function makeDb(opts: {
  holidays?: Array<{ holidayDate: string }>;
  curated?: DailyInputItem[];
  fetchedCount?: number;
  scoredCount?: number;
  targets?: Array<{ webhookUrl: string; signSecret: string | null }>;
}) {
  const values = [
    opts.holidays ?? [],
    opts.curated ?? [],
    [{ count: opts.fetchedCount ?? 0 }],
    [{ count: opts.scoredCount ?? 0 }],
    opts.targets ?? []
  ];
  let i = 0;
  return {
    select: vi.fn(() => makeThenableChain(values[i++] ?? []))
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    error: vi.fn()
  };
}

describe("health-check cron", () => {
  it("registers 09:00 Asia/Shanghai after daily-gen", () => {
    expect(HEALTH_CHECK_SCHEDULE_CRON).toBe("0 0 9 * * *");
    expect(HEALTH_CHECK_SCHEDULE_TZ).toBe(CHECK_TZ);
  });
});

describe("health-check production regression 2026-08-19 / 2026-08-18", () => {
  it("alerts on 2026-08-19 when curated=0 (fetched=270 scored=114)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const log = makeLogger();
    const db = makeDb({
      curated: [],
      fetchedCount: 270,
      scoredCount: 114,
      targets: [OPS_TARGET]
    });

    const result = await runHealthCheck({
      db: db as never,
      now: new Date("2026-08-19T09:00:00+08:00"),
      sendActionCardFn: send,
      logger: log
    });

    expect(result.alerted).toBe(true);
    expect(result.curatedCount).toBe(0);
    expect(result.fetchedCount).toBe(270);
    expect(result.scoredCount).toBe(114);
    expect(send).toHaveBeenCalledTimes(1);
    const card = send.mock.calls[0]?.[2] as { title: string; text: string };
    expect(card.text).toContain("2026-08-19");
    expect(card.text).toContain("0");
    expect(card.text).toContain("270");
    expect(card.text).toContain("114");
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        date: "2026-08-19",
        curatedCount: 0,
        fetchedCount: 270,
        scoredCount: 114,
        alerted: true,
        targetCount: 1
      }),
      "health check completed"
    );
  });

  it("does not alert on 2026-08-18 when curated=5", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const log = makeLogger();
    const db = makeDb({
      curated: curatedItems(5),
      fetchedCount: 354,
      scoredCount: 182,
      targets: [OPS_TARGET]
    });

    const result = await runHealthCheck({
      db: db as never,
      now: new Date("2026-08-18T09:00:00+08:00"),
      sendActionCardFn: send,
      logger: log
    });

    expect(result.alerted).toBe(false);
    expect(result.curatedCount).toBe(5);
    expect(result.fetchedCount).toBe(354);
    expect(result.scoredCount).toBe(182);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("runHealthCheck gates", () => {
  it("skips holidays without alerting", async () => {
    const send = vi.fn();
    const log = makeLogger();
    const result = await runHealthCheck({
      db: makeDb({ holidays: [{ holidayDate: "2026-08-19" }] }) as never,
      now: new Date("2026-08-19T09:00:00+08:00"),
      sendActionCardFn: send,
      logger: log
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("not_business_day");
    expect(result.alerted).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-08-19", reason: "not_business_day" }),
      "health check skipped"
    );
  });

  it("logs OPS_ALERT_NO_TARGET and returns when no ops target exists", async () => {
    const send = vi.fn();
    const log = makeLogger();
    const result = await runHealthCheck({
      db: makeDb({
        curated: [],
        fetchedCount: 270,
        scoredCount: 114,
        targets: []
      }) as never,
      now: new Date("2026-08-19T09:00:00+08:00"),
      sendActionCardFn: send,
      logger: log
    });

    expect(result.alerted).toBe(false);
    expect(result.targetCount).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: OPS_ALERT_NO_TARGET }),
      expect.any(String)
    );
  });

  it("swallows unexpected errors so the scheduler does not crash", async () => {
    const send = vi.fn();
    const log = makeLogger();
    const db = {
      select: vi.fn(() => {
        throw new Error("db down");
      })
    };

    await expect(runHealthCheck({
      db: db as never,
      now: new Date("2026-08-19T09:00:00+08:00"),
      sendActionCardFn: send,
      logger: log
    })).resolves.toMatchObject({ reason: "error", alerted: false });
    expect(send).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  it("reuses loadDailyInput instead of a second isCurated where", async () => {
    const loadDailyInputFn = vi.fn().mockResolvedValue([]);
    const send = vi.fn();
    await runHealthCheck({
      db: makeDb({
        fetchedCount: 1,
        scoredCount: 1,
        targets: [OPS_TARGET]
      }) as never,
      now: new Date("2026-08-19T09:00:00+08:00"),
      sendActionCardFn: send,
      loadDailyInputFn,
      logger: makeLogger()
    });
    expect(loadDailyInputFn).toHaveBeenCalledTimes(1);

    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../health-check.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/isCurated/);
  });
});

describe("buildHealthAlertCard", () => {
  it("includes date and the three diagnostic counts", () => {
    const card = buildHealthAlertCard({
      date: "2026-08-19",
      curatedCount: 0,
      fetchedCount: 270,
      scoredCount: 114
    });
    expect(card.title).toContain("严重");
    expect(card.text).toContain("2026-08-19");
    expect(card.text).toContain("0");
    expect(card.text).toContain("270");
    expect(card.text).toContain("114");
  });
});
