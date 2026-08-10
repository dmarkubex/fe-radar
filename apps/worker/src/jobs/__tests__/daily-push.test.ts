import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it, vi, beforeEach } from "vitest";

/** Per-invocation select cursor so Promise.all races don't interleave sequences. */
const selectAls = new AsyncLocalStorage<{ i: number; cycle: unknown[] }>();

// ---------------------------------------------------------------------------
// Mocks — stateful CAS store for concurrent / reclaim / stale scenarios
// ---------------------------------------------------------------------------

type PushRow = {
  id: number;
  reportDate: string;
  targetId: number;
  pushStatus: "pending" | "succeeded" | "failed";
  attemptCount: number;
  errorDetail: string | null;
  /** Simulated DB lease age in ms (only used by stale WHERE mock). */
  ageMs: number;
};

const pushStore = new Map<string, PushRow>();
let nextPushId = 1;
/** Simulated DB `now` offset control for stale boundary tests. */
let forcedStaleMatch: "auto" | "force_stale" | "force_fresh" = "auto";

function storeKey(reportDate: string, targetId: number): string {
  return `${reportDate}:${targetId}`;
}

const mockClaimReturning = vi.fn();
const mockOnConflictDoNothing = vi.fn().mockReturnValue({
  returning: mockClaimReturning,
});
const mockInsertValues = vi.fn().mockReturnValue({
  onConflictDoNothing: mockOnConflictDoNothing,
});
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateSet = vi.fn();
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
  chain.leftJoin = vi.fn().mockReturnValue(chain);
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
  eq: vi.fn((col, val) => ({ op: "eq", col, val })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  isNull: vi.fn(() => "isNull"),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      op: "sql",
      strings: Array.from(strings),
      values,
    }),
    { raw: (s: string) => ({ op: "sql_raw", s }) }
  ),
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
const sendCalls: Array<{ webhookUrl: string }> = [];

vi.mock("../../lib/dingtalk-bot", () => ({
  sendActionCard: vi.fn(
    async (webhookUrl: string, _secret: string, opts: { title: string; text: string; btns: unknown[] }) => {
      capturedCards.push(opts);
      sendCalls.push({ webhookUrl });
      return sendImpl();
    }
  ),
}));

vi.mock("p-limit", () => ({
  default: (_n: number) => (fn: () => Promise<unknown>) => fn(),
}));

import { runManualDailyPush, runScheduledDailyPush, STALE_PENDING_ERROR } from "../daily-push";
import { BRIEFING_PUSH_SCHEDULE_CRON } from "../../queues";

function setupSelectSequence(results: unknown[]) {
  let callIdx = 0;
  mockSelect.mockImplementation(() => buildSelectChain(results[callIdx++] ?? []));
}

/**
 * Select mock for concurrent run* calls: each AsyncLocalStorage session has its
 * own cycle cursor; extras (loadExistingPush) read pushStore.
 */
function installConcurrentSelectMock(cycle: unknown[]) {
  mockSelect.mockImplementation(() => {
    const store = selectAls.getStore();
    if (store) {
      if (store.i < store.cycle.length) {
        return buildSelectChain(store.cycle[store.i++]);
      }
    }
    const rows = Array.from(pushStore.values()).map((r) => ({
      id: r.id,
      pushStatus: r.pushStatus,
      attemptCount: r.attemptCount,
    }));
    return buildSelectChain(rows.length ? [rows[0]] : []);
  });
  return cycle;
}

async function runScheduledInSession(
  cycle: unknown[],
  now: Date
): Promise<Awaited<ReturnType<typeof runScheduledDailyPush>>> {
  return selectAls.run({ i: 0, cycle }, () =>
    runScheduledDailyPush({ now, sleepFn: async () => undefined })
  );
}

async function runManualInSession(
  cycle: unknown[],
  reportDate: string
): Promise<Awaited<ReturnType<typeof runManualDailyPush>>> {
  return selectAls.run({ i: 0, cycle }, () =>
    runManualDailyPush(reportDate, { sleepFn: async () => undefined })
  );
}

/**
 * Wire insert/update to the in-memory pushStore so concurrent claims and CAS
 * authorization actually race against shared state.
 */
function wireCasStore() {
  mockInsertValues.mockImplementation((values: Record<string, unknown>) => {
    const reportDate = values["reportDate"] as string;
    const targetId = values["targetId"] as number;
    return {
      onConflictDoNothing: () => ({
        returning: async () => {
          const k = storeKey(reportDate, targetId);
          if (pushStore.has(k)) return [];
          const row: PushRow = {
            id: nextPushId++,
            reportDate,
            targetId,
            pushStatus: "pending",
            attemptCount: 0,
            errorDetail: null,
            ageMs: 0,
          };
          pushStore.set(k, row);
          return [{ id: row.id, attemptCount: row.attemptCount }];
        },
      }),
    };
  });

  mockUpdateSet.mockImplementation((setVals: Record<string, unknown>) => {
    return {
      where: (_where: unknown) => ({
        returning: async () => applyUpdate(setVals),
      }),
    };
  });
}

/**
 * Interpret update set payload heuristically (mocks don't re-eval SQL WHERE).
 * authorize: attemptCount is sql expr, no pushStatus in set (or only lease fields)
 * reclaim: pushStatus pending + attemptCount sql
 * stale mark: pushStatus failed + STALE error
 * finalize: pushStatus succeeded|failed without attemptCount sql bump as sole change
 */
function isStaleRow(row: PushRow): boolean {
  if (forcedStaleMatch === "force_stale") return true;
  if (forcedStaleMatch === "force_fresh") return false;
  return row.ageMs >= 120_000;
}

function applyUpdate(setVals: Record<string, unknown>): Array<Record<string, unknown>> {
  const status = setVals["pushStatus"] as string | undefined;
  const err = setVals["errorDetail"] as string | null | undefined;
  const hasAttemptSql = setVals["attemptCount"] != null && typeof setVals["attemptCount"] === "object";

  // Stale mark: failed + STALE_PENDING_DELIVERY_UNKNOWN
  if (status === "failed" && err === STALE_PENDING_ERROR) {
    for (const row of pushStore.values()) {
      if (row.pushStatus !== "pending") continue;
      if (!isStaleRow(row)) continue;
      row.pushStatus = "failed";
      row.errorDetail = STALE_PENDING_ERROR;
      return [{ id: row.id }];
    }
    return [];
  }

  // Reclaim: pushStatus → pending + attempt bump (failed or stale pending only)
  if (status === "pending" && hasAttemptSql) {
    for (const row of pushStore.values()) {
      if (row.pushStatus === "failed") {
        row.pushStatus = "pending";
        row.attemptCount += 1;
        row.errorDetail = null;
        row.ageMs = 0;
        return [{ attemptCount: row.attemptCount }];
      }
      if (row.pushStatus === "pending" && isStaleRow(row)) {
        row.attemptCount += 1;
        row.errorDetail = null;
        row.ageMs = 0;
        return [{ attemptCount: row.attemptCount }];
      }
    }
    return [];
  }

  // Finalize succeeded/failed (terminal CAS on pending)
  if ((status === "succeeded" || status === "failed") && !hasAttemptSql) {
    for (const row of pushStore.values()) {
      if (row.pushStatus !== "pending") continue;
      row.pushStatus = status;
      row.errorDetail = (err as string | null) ?? null;
      return [{ id: row.id }];
    }
    return [];
  }

  // Authorize: attemptCount sql + pushedAt renew, no status change
  if (hasAttemptSql && status == null) {
    for (const row of pushStore.values()) {
      if (row.pushStatus !== "pending") continue;
      row.attemptCount += 1;
      row.ageMs = 0;
      return [{ attemptCount: row.attemptCount }];
    }
    return [];
  }

  return [];
}

/** Seed a row into the store (for failed/pending scenarios). */
function seedPush(row: Omit<PushRow, "id"> & { id?: number }): PushRow {
  const full: PushRow = {
    id: row.id ?? nextPushId++,
    reportDate: row.reportDate,
    targetId: row.targetId,
    pushStatus: row.pushStatus,
    attemptCount: row.attemptCount,
    errorDetail: row.errorDetail,
    ageMs: row.ageMs,
  };
  if (full.id >= nextPushId) nextPushId = full.id + 1;
  pushStore.set(storeKey(full.reportDate, full.targetId), full);
  return full;
}

/**
 * Select sequence helper that also serves loadExistingPush from the store
 * when the test reaches per-target lookups (after claim miss).
 */
function setupHappyPathSelects(opts?: {
  config?: Record<string, unknown>;
  targets?: Array<Record<string, unknown>>;
  earlyExit?: Array<Record<string, unknown>>;
  sections?: Record<string, string> | null;
  extraAfterTargets?: unknown[];
}) {
  const cfg = opts?.config ?? enabledConfig;
  const targets = opts?.targets ?? [
    { id: 1, name: "群A", webhookUrl: "https://hook/a", signSecret: "s" },
  ];
  const sections =
    opts?.sections === null
      ? null
      : (opts?.sections ?? {
          policy: "政策摘要",
          market: "市场摘要",
          tech: "技术摘要",
          project: "项目摘要",
          company: "公司摘要",
        });
  // early exit: unfinished = target with null succeededPushId
  const early =
    opts?.earlyExit ??
    targets.map((t) => ({ targetId: t.id, succeededPushId: null }));

  const seq: unknown[] = [[cfg]];
  if ((cfg as { scheduleMode?: string }).scheduleMode === "business_days") {
    seq.push([]); // holidays
  }
  seq.push(early);
  if (sections) {
    seq.push([{ date: "2026-08-03", sections }]);
  } else {
    seq.push([]);
  }
  seq.push(targets);
  if (opts?.extraAfterTargets) seq.push(...opts.extraAfterTargets);

  // After fixed sequence, fall back to store-backed existing-row lookups
  let callIdx = 0;
  mockSelect.mockImplementation(() => {
    if (callIdx < seq.length) {
      return buildSelectChain(seq[callIdx++]);
    }
    // loadExistingPush: return matching store rows for any leftover selects
    const rows = Array.from(pushStore.values()).map((r) => ({
      id: r.id,
      pushStatus: r.pushStatus,
      attemptCount: r.attemptCount,
    }));
    return buildSelectChain(rows.length ? [rows[0]] : []);
  });
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
/** Spec §5: 2026-08-03T16:05:00Z → Shanghai 2026-08-04 00:05 */
const MIDNIGHT_TICK = new Date("2026-08-03T16:05:00.000Z");

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
  pushStore.clear();
  nextPushId = 1;
  forcedStaleMatch = "auto";
  mockOnConflictDoNothing.mockReturnValue({ returning: mockClaimReturning });
  mockInsertValues.mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockUpdate.mockReturnValue({ set: mockUpdateSet });
  wireCasStore();
});

describe("BRIEFING_PUSH_SCHEDULE_CRON", () => {
  it("is a per-minute BullMQ 6-field cron", () => {
    expect(BRIEFING_PUSH_SCHEDULE_CRON).toBe("0 * * * * *");
  });
});

describe("runScheduledDailyPush gates", () => {
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
    setupHappyPathSelects({
      config: enabledConfig,
      targets: [{ id: 1, name: "群A", webhookUrl: "https://hook/a", signSecret: "s" }],
    });
    const result = await runScheduledDailyPush({ now: LATE_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(false);
    expect(result.succeeded).toBe(1);
    expect(sendCalls).toHaveLength(1);
  });

  it("skips on weekend/holiday when schedule_mode=business_days", async () => {
    businessDay = false;
    setupSelectSequence([[enabledConfig], []]);
    const result = await runScheduledDailyPush({ now: WEEKEND_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("not_business_day");
    expect(sendCalls).toHaveLength(0);
  });

  it("skips when no targets even if content exists", async () => {
    setupHappyPathSelects({ targets: [], earlyExit: [] });
    // After early exit empty + no targets path needs content then empty targets
    // earlyExit [] with targets [] → allActiveTargetsSucceeded false (length 0)
    // then content + empty targets → no_targets
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no_targets");
    expect(sendCalls).toHaveLength(0);
  });

  it("skips when no daily report exists", async () => {
    setupHappyPathSelects({ sections: null });
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no_content");
    expect(sendCalls).toHaveLength(0);
  });

  it("treats empty daily sections {} as no daily content", async () => {
    // hasDailyContent({}) is false
    setupHappyPathSelects({
      sections: {} as unknown as Record<string, string>,
    });
    // Override: empty object still loads a row but hasDailyContent is false
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no_content");
    expect(sendCalls).toHaveLength(0);
  });
});

describe("CAS claim-first + authorize", () => {
  it("sends daily-only card after successful claim + authorize", async () => {
    setupHappyPathSelects();
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(false);
    expect(result.succeeded).toBe(1);
    expect(mockInsert).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
    expect(capturedCards[0]?.title).toContain("日报");
    expect(capturedCards[0]?.btns).toHaveLength(1);
    expect((capturedCards[0]?.btns[0] as { title: string }).title).toBe("查看产业日报");
    expect(capturedCards[0]?.text).not.toContain("铜锂");
    // attemptCount advanced by authorize (=1 after one successful send)
    const row = pushStore.get("2026-08-03:1");
    expect(row?.pushStatus).toBe("succeeded");
    expect(row?.attemptCount).toBe(1);
  });

  it("is idempotent: existing succeeded skips send", async () => {
    seedPush({
      reportDate: "2026-08-03",
      targetId: 4,
      pushStatus: "succeeded",
      attemptCount: 1,
      errorDetail: null,
      ageMs: 0,
    });
    setupHappyPathSelects({
      targets: [{ id: 4, name: "群D", webhookUrl: "https://hook/d", signSecret: null }],
    });
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(false);
    expect(result.skippedSucceeded).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(sendCalls).toHaveLength(0);
  });

  it("concurrent claims on same (reportDate, targetId): exactly one webhook", async () => {
    const target = { id: 99, name: "race", webhookUrl: "https://hook/race", signSecret: null };
    const cycle = [
      [enabledConfig],
      [],
      [{ targetId: 99, succeededPushId: null }],
      [{ date: "2026-08-03", sections }],
      [target],
    ];
    installConcurrentSelectMock(cycle);

    const [r1, r2] = await Promise.all([
      runScheduledInSession(cycle, HIT_NOW),
      runScheduledInSession(cycle, HIT_NOW),
    ]);

    const totalSucceeded = r1.succeeded + r2.succeeded;
    const totalSkippedClaimed = r1.skippedClaimed + r2.skippedClaimed;
    expect(totalSucceeded).toBe(1);
    expect(totalSkippedClaimed).toBe(1);
    expect(sendCalls).toHaveLength(1);
    expect(pushStore.size).toBe(1);
    const only = Array.from(pushStore.values())[0]!;
    expect(only.pushStatus).toBe("succeeded");
    expect(only.attemptCount).toBe(1);
  });

  it("20 concurrent claims → 1 success claim, 1 webhook, 1 row", async () => {
    const target = { id: 7, name: "hot", webhookUrl: "https://hook/hot", signSecret: null };
    const cycle = [
      [enabledConfig],
      [],
      [{ targetId: 7, succeededPushId: null }],
      [{ date: "2026-08-03", sections }],
      [target],
    ];
    installConcurrentSelectMock(cycle);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => runScheduledInSession(cycle, HIT_NOW))
    );

    expect(results.reduce((s, r) => s + r.succeeded, 0)).toBe(1);
    expect(sendCalls).toHaveLength(1);
    expect(pushStore.size).toBe(1);
  });

  it("failed row is not auto-retried across 10 simulated ticks (webhook delta 0)", async () => {
    seedPush({
      reportDate: "2026-08-03",
      targetId: 1,
      pushStatus: "failed",
      attemptCount: 3,
      errorDetail: "boom",
      ageMs: 0,
    });
    setupHappyPathSelects();
    const before = sendCalls.length;
    for (let i = 0; i < 10; i++) {
      // Re-arm select sequence each tick
      setupHappyPathSelects();
      const r = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
      expect(r.succeeded).toBe(0);
      expect(r.failed).toBe(0);
    }
    expect(sendCalls.length - before).toBe(0);
    expect(pushStore.get("2026-08-03:1")?.pushStatus).toBe("failed");
    expect(pushStore.get("2026-08-03:1")?.attemptCount).toBe(3);
  });

  it("webhook failure exhausts 3 authorized attempts then terminal failed", async () => {
    sendImpl = async () => {
      throw new Error("webhook down");
    };
    setupHappyPathSelects();
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.failed).toBe(1);
    expect(sendCalls).toHaveLength(3);
    const row = pushStore.get("2026-08-03:1")!;
    expect(row.pushStatus).toBe("failed");
    expect(row.attemptCount).toBe(3);
  });

  it("isolates single-target failure from other targets", async () => {
    sendImpl = async () => {
      const last = sendCalls[sendCalls.length - 1];
      if (last?.webhookUrl.includes("/fail")) throw new Error("webhook down");
    };
    setupHappyPathSelects({
      targets: [
        { id: 10, name: "fail", webhookUrl: "https://hook/fail", signSecret: null },
        { id: 11, name: "ok", webhookUrl: "https://hook/ok", signSecret: null },
      ],
      earlyExit: [
        { targetId: 10, succeededPushId: null },
        { targetId: 11, succeededPushId: null },
      ],
    });
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(1);
    // fail: 3 attempts, ok: 1
    expect(sendCalls.length).toBe(4);
  });
});

describe("stale pending (120s boundary)", () => {
  it("119999ms pending is NOT stale — no mark, no webhook", async () => {
    seedPush({
      reportDate: "2026-08-03",
      targetId: 1,
      pushStatus: "pending",
      attemptCount: 0,
      errorDetail: null,
      ageMs: 119_999,
    });
    forcedStaleMatch = "auto";
    setupHappyPathSelects();
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(sendCalls).toHaveLength(0);
    expect(result.skippedClaimed).toBe(1);
    expect(pushStore.get("2026-08-03:1")?.pushStatus).toBe("pending");
  });

  it("120000ms pending IS stale — mark failed once, no webhook", async () => {
    seedPush({
      reportDate: "2026-08-03",
      targetId: 1,
      pushStatus: "pending",
      attemptCount: 1,
      errorDetail: null,
      ageMs: 120_000,
    });
    setupHappyPathSelects();
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(sendCalls).toHaveLength(0);
    expect(result.skippedClaimed).toBe(1);
    const row = pushStore.get("2026-08-03:1")!;
    expect(row.pushStatus).toBe("failed");
    expect(row.errorDetail).toBe(STALE_PENDING_ERROR);
  });
});

describe("runManualDailyPush reclaim", () => {
  it("manual reclaim of failed → succeeded with attemptCount = prior+1 on first success", async () => {
    seedPush({
      reportDate: "2026-08-03",
      targetId: 1,
      pushStatus: "failed",
      attemptCount: 3,
      errorDetail: "prev",
      ageMs: 0,
    });
    // manual path: config → holidays → early → content → targets
    setupHappyPathSelects();
    const result = await runManualDailyPush("2026-08-03", { sleepFn: async () => undefined });
    expect(result.succeeded).toBe(1);
    expect(sendCalls).toHaveLength(1);
    const row = pushStore.get("2026-08-03:1")!;
    expect(row.pushStatus).toBe("succeeded");
    // reclaim authorizes first attempt: 3 → 4
    expect(row.attemptCount).toBe(4);
  });

  it("manual does not force-resend succeeded", async () => {
    seedPush({
      reportDate: "2026-08-03",
      targetId: 1,
      pushStatus: "succeeded",
      attemptCount: 1,
      errorDetail: null,
      ageMs: 0,
    });
    setupHappyPathSelects();
    const result = await runManualDailyPush("2026-08-03", { sleepFn: async () => undefined });
    expect(result.skippedSucceeded).toBe(1);
    expect(sendCalls).toHaveLength(0);
  });

  it("two concurrent manual reclaims on failed: only one sends", async () => {
    seedPush({
      reportDate: "2026-08-03",
      targetId: 1,
      pushStatus: "failed",
      attemptCount: 3,
      errorDetail: "prev",
      ageMs: 0,
    });

    const cycle = [
      [enabledConfig],
      [],
      [{ targetId: 1, succeededPushId: null }],
      [{ date: "2026-08-03", sections }],
      [{ id: 1, name: "群A", webhookUrl: "https://hook/a", signSecret: "s" }],
    ];
    installConcurrentSelectMock(cycle);

    const [a, b] = await Promise.all([
      runManualInSession(cycle, "2026-08-03"),
      runManualInSession(cycle, "2026-08-03"),
    ]);

    expect(a.succeeded + b.succeeded).toBe(1);
    expect(sendCalls).toHaveLength(1);
    expect(pushStore.get("2026-08-03:1")?.pushStatus).toBe("succeeded");
  });
});

describe("all_targets_succeeded early exit", () => {
  it("skips without webhook when every active target already succeeded", async () => {
    setupSelectSequence([
      [enabledConfig],
      [], // holidays
      // early exit: all have succeededPushId
      [
        { targetId: 1, succeededPushId: 100 },
        { targetId: 2, succeededPushId: 101 },
      ],
    ]);
    const result = await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("all_targets_succeeded");
    expect(sendCalls).toHaveLength(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("single clock (injected now)", () => {
  it("uses injected now for reportDate — not host wall clock", async () => {
    // MIDNIGHT_TICK → Shanghai 2026-08-04 00:05; send_time 16:15 not yet → time_mismatch
    // but reportDate in skip result must be 2026-08-04
    setupSelectSequence([
      [{ ...enabledConfig, sendTime: "16:15", scheduleMode: "daily" }],
    ]);
    const result = await runScheduledDailyPush({
      now: MIDNIGHT_TICK,
      sleepFn: async () => undefined,
    });
    expect(result.reportDate).toBe("2026-08-04");
    expect(result.reason).toBe("time_mismatch");
  });
});

describe("mechanical: no pushedAt equality in ownership updates", () => {
  it("update set/where never passes a JS Date as pushedAt equality token", async () => {
    setupHappyPathSelects();
    await runScheduledDailyPush({ now: HIT_NOW, sleepFn: async () => undefined });
    // Every set() call: pushedAt if present must be sql fragment, not Date
    for (const call of mockUpdateSet.mock.calls) {
      const setVals = call[0] as Record<string, unknown>;
      if ("pushedAt" in setVals) {
        expect(setVals["pushedAt"]).not.toBeInstanceOf(Date);
        // should be sql template object from our mock
        expect(typeof setVals["pushedAt"]).toBe("object");
      }
    }
  });
});
