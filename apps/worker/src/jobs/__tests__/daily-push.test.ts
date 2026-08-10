import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockClaimReturning = vi.fn();
const mockOnConflictDoNothing = vi.fn().mockReturnValue({
  returning: mockClaimReturning,
});
const mockInsertValues = vi.fn().mockReturnValue({
  onConflictDoNothing: mockOnConflictDoNothing,
});
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

function buildSelectChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  const asPromise = Promise.resolve(result);
  chain.then = asPromise.then.bind(asPromise);
  chain.catch = asPromise.catch.bind(asPromise);
  chain.finally = asPromise.finally.bind(asPromise);
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(result);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  return chain;
}

const mockSelect = vi.fn();

vi.mock("@fe-radar/db", () => ({
  getDb: () => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  }),
  dailyPushConfig: {
    id: "id",
    enabled: "enabled",
    sendTime: "send_time",
    scheduleMode: "schedule_mode",
    baseUrl: "base_url",
  },
  dailyPushes: {
    id: "id",
    reportDate: "report_date",
    targetId: "target_id",
    briefingId: "briefing_id",
    dailyReportPresent: "daily_report_present",
    briefingPresent: "briefing_present",
    pushStatus: "push_status",
    attemptCount: "attempt_count",
    errorDetail: "error_detail",
    pushedAt: "pushed_at",
  },
  dailyReports: { date: "date", sections: "sections" },
  commodityBriefings: {
    id: "id",
    briefingDate: "briefing_date",
    genStatus: "gen_status",
    payloadJson: "payload_json",
  },
  briefingTargets: {
    id: "id",
    name: "name",
    webhookUrl: "webhook_url",
    signSecret: "sign_secret",
    enabled: "enabled",
    disabledAt: "disabled_at",
  },
  briefingHolidays: { holidayDate: "holiday_date" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn(() => "and"),
  isNull: vi.fn(() => "isNull"),
}));

let businessDay = true;
vi.mock("@fe-radar/core", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    isBusinessDay: vi.fn(() => businessDay),
  };
});

vi.mock("@fe-radar/shared", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

const capturedCards: Array<{ title: string; text: string; btns: unknown[] }> = [];
let sendImpl: () => Promise<void> = async () => undefined;
const sendCalls: Array<{ targetId?: number; webhookUrl: string }> = [];

vi.mock("../../lib/dingtalk-bot", () => ({
  sendActionCard: vi.fn(async (webhookUrl: string, _secret: string, opts: { title: string; text: string; btns: unknown[] }) => {
    capturedCards.push(opts);
    sendCalls.push({ webhookUrl });
    return sendImpl();
  }),
}));

vi.mock("p-limit", () => ({
  default: (_n: number) => (fn: () => Promise<unknown>) => fn(),
}));

import { runScheduledDailyPush } from "../daily-push";
import { BRIEFING_PUSH_SCHEDULE_CRON } from "../../queues";

function setupSelectSequence(results: unknown[]) {
  let callIdx = 0;
  mockSelect.mockImplementation(() => buildSelectChain(results[callIdx++] ?? []));
}

/** Default: each claim INSERT succeeds with a new id. */
function setupSuccessfulClaims(startId = 100) {
  let id = startId;
  mockClaimReturning.mockImplementation(async () => [{ id: id++ }]);
}

const sections = {
  policy: "政策摘要",
  market: "市场摘要",
  tech: "技术摘要",
  project: "项目摘要",
  company: "公司摘要",
};

/** Monday 2026-08-03 16:15 Asia/Shanghai = 08:15 UTC */
const HIT_NOW = new Date("2026-08-03T08:15:00.000Z");
/** Monday 2026-08-03 16:14 Asia/Shanghai — before send_time */
const MISS_NOW = new Date("2026-08-03T08:14:00.000Z");
/** Monday 2026-08-03 16:18 Asia/Shanghai — after send_time, content arrived late */
const LATE_NOW = new Date("2026-08-03T08:18:00.000Z");
/** Saturday 2026-08-08 16:15 Asia/Shanghai */
const WEEKEND_NOW = new Date("2026-08-08T08:15:00.000Z");

const enabledConfig = {
  enabled: true,
  sendTime: "16:15",
  scheduleMode: "business_days",
  baseUrl: "http://fe-radar.internal",
};

beforeEach(() => {
  vi.clearAllMocks();
  capturedCards.length = 0;
  sendCalls.length = 0;
  sendImpl = async () => undefined;
  businessDay = true;
  mockOnConflictDoNothing.mockReturnValue({ returning: mockClaimReturning });
  mockInsertValues.mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdate.mockReturnValue({ set: mockUpdateSet });
  mockUpdateWhere.mockResolvedValue(undefined);
  setupSuccessfulClaims();
});

describe("BRIEFING_PUSH_SCHEDULE_CRON", () => {
  it("is a per-minute BullMQ 6-field cron", () => {
    expect(BRIEFING_PUSH_SCHEDULE_CRON).toBe("0 * * * * *");
  });
});

describe("runScheduledDailyPush", () => {
  it("skips when config is disabled", async () => {
    setupSelectSequence([[{ ...enabledConfig, enabled: false }]]);
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("disabled");
    expect(sendCalls).toHaveLength(0);
  });

  it("skips when current minute does not match send_time", async () => {
    setupSelectSequence([[enabledConfig]]);
    const result = await runScheduledDailyPush({ now: MISS_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("time_mismatch");
    expect(sendCalls).toHaveLength(0);
  });

  it("still pushes on a later tick when content lands after send_time", async () => {
    setupSelectSequence([
      [enabledConfig],
      [], // holidays
      [{ date: "2026-08-03", sections }],
      [{ id: 1, name: "群A", webhookUrl: "https://hook/a", signSecret: "s" }],
    ]);
    const result = await runScheduledDailyPush({ now: LATE_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(false);
    expect(result.succeeded).toBe(1);
    expect(sendCalls).toHaveLength(1);
  });

  it("skips on weekend/holiday when schedule_mode=business_days", async () => {
    businessDay = false;
    setupSelectSequence([
      [enabledConfig],
      [], // holidays
    ]);
    const result = await runScheduledDailyPush({ now: WEEKEND_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("not_business_day");
    expect(sendCalls).toHaveLength(0);
  });

  it("skips when no targets even if content exists", async () => {
    setupSelectSequence([
      [enabledConfig],
      [], // holidays
      [{ date: "2026-08-03", sections }],
      [], // targets
    ]);
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no_targets");
    expect(sendCalls).toHaveLength(0);
  });

  it("skips when no daily report exists", async () => {
    setupSelectSequence([
      [enabledConfig],
      [], // holidays
      [], // daily
    ]);
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no_content");
    expect(sendCalls).toHaveLength(0);
  });

  it("treats empty daily sections {} as no daily content", async () => {
    setupSelectSequence([
      [enabledConfig],
      [],
      [{ date: "2026-08-03", sections: {} }],
    ]);
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no_content");
    expect(sendCalls).toHaveLength(0);
  });

  it("sends daily-only card after successful claim", async () => {
    setupSelectSequence([
      [enabledConfig],
      [], // holidays
      [{ date: "2026-08-03", sections }],
      [{ id: 1, name: "群A", webhookUrl: "https://hook/a", signSecret: "s" }],
    ]);
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(false);
    expect(result.succeeded).toBe(1);
    expect(mockInsert).toHaveBeenCalled();
    expect(mockOnConflictDoNothing).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
    expect(capturedCards[0]?.title).toContain("日报");
    expect(capturedCards[0]?.btns).toHaveLength(1);
    expect((capturedCards[0]?.btns[0] as { title: string }).title).toBe("查看产业日报");
    // 0060: 铜锂日报 is its own card at its own time, never merged into this one.
    expect(capturedCards[0]?.text).not.toContain("铜锂");
  });

  it("is idempotent: failed claim + existing succeeded skips send", async () => {
    mockClaimReturning.mockResolvedValueOnce([]); // claim lost
    setupSelectSequence([
      [enabledConfig],
      [],
      [{ date: "2026-08-03", sections }],
      [{ id: 4, name: "群D", webhookUrl: "https://hook/d", signSecret: null }],
      [{ pushStatus: "succeeded" }], // existing row after failed claim
    ]);
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(false);
    expect(result.skippedSucceeded).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(sendCalls).toHaveLength(0);
  });

  it("concurrent claim: only RETURNING winner sends webhook", async () => {
    // First target claims, second loses claim (simulates concurrent tick)
    mockClaimReturning
      .mockResolvedValueOnce([{ id: 501 }])
      .mockResolvedValueOnce([]);

    setupSelectSequence([
      [enabledConfig],
      [],
      [{ date: "2026-08-03", sections }],
      [
        { id: 10, name: "winner", webhookUrl: "https://hook/win", signSecret: null },
        { id: 11, name: "loser", webhookUrl: "https://hook/lose", signSecret: null },
      ],
      [{ pushStatus: "pending" }], // loser looks up existing after failed claim
    ]);
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.succeeded).toBe(1);
    expect(result.skippedClaimed).toBe(1);
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]?.webhookUrl).toContain("/win");
  });

  it("isolates single-target failure from other targets", async () => {
    sendImpl = async () => {
      const last = sendCalls[sendCalls.length - 1];
      if (last?.webhookUrl.includes("/fail")) throw new Error("webhook down");
    };
    setupSelectSequence([
      [enabledConfig],
      [],
      [{ date: "2026-08-03", sections }],
      [
        { id: 10, name: "fail", webhookUrl: "https://hook/fail", signSecret: null },
        { id: 11, name: "ok", webhookUrl: "https://hook/ok", signSecret: null },
      ],
    ]);
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(1);
    // first target retries 3 times, second once
    expect(sendCalls.length).toBe(4);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });
});
