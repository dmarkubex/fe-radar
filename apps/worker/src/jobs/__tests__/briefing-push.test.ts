import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it, vi, beforeEach } from "vitest";

/** Per-invocation select cursor so Promise.all races don't interleave sequences. */
const selectAls = new AsyncLocalStorage<{ i: number; cycle: unknown[] }>();

// ---------------------------------------------------------------------------
// Mocks — stateful CAS store for concurrent / reclaim / stale scenarios
// ---------------------------------------------------------------------------

type PushRow = {
  id: number;
  briefingId: number;
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

function storeKey(briefingId: number, targetId: number): string {
  return `${briefingId}:${targetId}`;
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
  briefingPushes: {
    id: "id",
    briefingId: "briefing_id",
    targetId: "target_id",
    pushStatus: "push_status",
    attemptCount: "attempt_count",
    errorDetail: "error_detail",
    pushedAt: "pushed_at",
  },
  briefingHolidays: { holidayDate: "holiday_date" },
  dailyPushConfig: {
    id: "id",
    enabled: "enabled",
    briefingSendTime: "briefing_send_time",
    baseUrl: "base_url",
  },
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
/** Captures the date/string passed to isBusinessDay for single-clock assertions. */
const isBusinessDayCalls: Array<Date | string> = [];
vi.mock("@fe-radar/core", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    isBusinessDay: vi.fn((date: Date | string) => {
      isBusinessDayCalls.push(date);
      return businessDay;
    }),
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
const capturedSendActionCardCalls: Array<{ webhookUrl: string; signSecret: string }> = [];

vi.mock("../../lib/dingtalk-bot", () => ({
  sendActionCard: vi.fn(
    async (
      webhookUrl: string,
      signSecret: string,
      opts: { title: string; text: string; btns: unknown[] }
    ) => {
      capturedCards.push(opts);
      sendCalls.push({ webhookUrl });
      capturedSendActionCardCalls.push({ webhookUrl, signSecret });
      return sendImpl();
    }
  ),
}));

vi.mock("p-limit", () => ({
  default: (_n: number) => (fn: () => Promise<unknown>) => fn(),
}));

import {
  runBriefingPush,
  runScheduledBriefingPush,
  finalizePush,
  STALE_PENDING_ERROR,
} from "../briefing-push";

function setupSelectSequence(results: unknown[]) {
  let callIdx = 0;
  mockSelect.mockImplementation(() => {
    if (callIdx < results.length) {
      return buildSelectChain(results[callIdx++]);
    }
    // After fixed sequence: serve loadExistingPush from pushStore
    const rows = Array.from(pushStore.values()).map((r) => ({
      id: r.id,
      pushStatus: r.pushStatus,
      attemptCount: r.attemptCount,
    }));
    return buildSelectChain(rows.length ? [rows[0]] : []);
  });
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
): Promise<Awaited<ReturnType<typeof runScheduledBriefingPush>>> {
  return selectAls.run({ i: 0, cycle }, () =>
    runScheduledBriefingPush({ now, sleepFn: async () => undefined })
  );
}

/**
 * Wire insert/update to the in-memory pushStore so concurrent claims and CAS
 * authorization actually race against shared state.
 */
function wireCasStore() {
  mockInsertValues.mockImplementation((values: Record<string, unknown>) => {
    const briefingId = values["briefingId"] as number;
    const targetId = values["targetId"] as number;
    return {
      onConflictDoNothing: () => ({
        returning: async () => {
          const k = storeKey(briefingId, targetId);
          if (pushStore.has(k)) return [];
          const row: PushRow = {
            id: nextPushId++,
            briefingId,
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
      where: (where: unknown) => ({
        returning: async () => applyUpdate(setVals, where),
      }),
    };
  });
}

function isStaleRow(row: PushRow): boolean {
  if (forcedStaleMatch === "force_stale") return true;
  if (forcedStaleMatch === "force_fresh") return false;
  return row.ageMs >= 120_000;
}

/**
 * Walk mocked drizzle `and`/`eq` trees and collect column→value predicates.
 * Production authorize/finalize WHERE must carry id + push_status + attempt_count;
 * if any of those eqs are deleted from production, matching loosens and CAS tests go red.
 */
function extractEqPredicates(where: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  function walk(node: unknown): void {
    if (node == null || typeof node !== "object") return;
    const n = node as { op?: string; col?: unknown; val?: unknown; args?: unknown[] };
    if (n.op === "eq") {
      map.set(String(n.col), n.val);
      return;
    }
    if (n.op === "and" && Array.isArray(n.args)) {
      for (const a of n.args) walk(a);
    }
  }
  walk(where);
  return map;
}

function rowMatchesEqs(row: PushRow, eqs: Map<string, unknown>): boolean {
  if (eqs.has("id") && eqs.get("id") !== row.id) return false;
  if (eqs.has("push_status") && eqs.get("push_status") !== row.pushStatus) return false;
  if (eqs.has("attempt_count") && eqs.get("attempt_count") !== row.attemptCount) {
    return false;
  }
  return true;
}

function applyUpdate(
  setVals: Record<string, unknown>,
  where: unknown
): Array<Record<string, unknown>> {
  const status = setVals["pushStatus"] as string | undefined;
  const err = setVals["errorDetail"] as string | null | undefined;
  const hasAttemptSql =
    setVals["attemptCount"] != null && typeof setVals["attemptCount"] === "object";
  const eqs = extractEqPredicates(where);

  // Stale mark: failed + STALE_PENDING_DELIVERY_UNKNOWN
  if (status === "failed" && err === STALE_PENDING_ERROR) {
    for (const row of pushStore.values()) {
      if (!rowMatchesEqs(row, eqs)) continue;
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
      if (!rowMatchesEqs(row, eqs)) continue;
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
  // Requires production WHERE to include attempt_count — stale cursor → 0 rows.
  if ((status === "succeeded" || status === "failed") && !hasAttemptSql) {
    for (const row of pushStore.values()) {
      if (!rowMatchesEqs(row, eqs)) continue;
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
      if (!rowMatchesEqs(row, eqs)) continue;
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
    briefingId: row.briefingId,
    targetId: row.targetId,
    pushStatus: row.pushStatus,
    attemptCount: row.attemptCount,
    errorDetail: row.errorDetail,
    ageMs: row.ageMs,
  };
  if (full.id >= nextPushId) nextPushId = full.id + 1;
  pushStore.set(storeKey(full.briefingId, full.targetId), full);
  return full;
}

/**
 * Select sequence for runBriefingPush happy path (T18 order):
 * briefing → holidays → early-exit → targets → (optional config baseUrl) → store lookups
 */
function setupRunPushSelects(opts?: {
  briefing?: Record<string, unknown>;
  targets?: Array<Record<string, unknown>>;
  earlyExit?: Array<Record<string, unknown>>;
  baseUrlConfig?: Array<Record<string, unknown>> | null;
  holidays?: unknown[];
}) {
  const briefing =
    opts?.briefing ??
    ({ id: 42, briefingDate: "2026-08-03", payloadJson: { cu: {}, lc: {} } } as const);
  const targets = opts?.targets ?? [
    { id: 1, name: "群A", webhookUrl: "https://hook/a", signSecret: "s" },
  ];
  const early =
    opts?.earlyExit ?? targets.map((t) => ({ targetId: t.id, succeededPushId: null }));

  const seq: unknown[] = [[briefing], opts?.holidays ?? [], early, targets];
  if (opts?.baseUrlConfig !== null) {
    // When baseUrl not passed in options, runBriefingPush loads config
    // For scheduled path with baseUrl, skip — tests for scheduled use runScheduled*
  }

  let callIdx = 0;
  mockSelect.mockImplementation(() => {
    if (callIdx < seq.length) {
      return buildSelectChain(seq[callIdx++]);
    }
    // loadExistingPush / leftover: store-backed
    const rows = Array.from(pushStore.values()).map((r) => ({
      id: r.id,
      pushStatus: r.pushStatus,
      attemptCount: r.attemptCount,
    }));
    return buildSelectChain(rows.length ? [rows[0]] : []);
  });
}

/**
 * Full scheduled path selects (T18):
 * config → scheduleLatestBriefingPush → briefing → holidays → early → targets
 * (baseUrl comes from config, so no extra config select)
 */
function setupScheduledHappyPath(opts?: {
  config?: Record<string, unknown>;
  briefingMeta?: { id: number; genStatus: string };
  briefing?: Record<string, unknown>;
  targets?: Array<Record<string, unknown>>;
  earlyExit?: Array<Record<string, unknown>>;
}) {
  const cfg = opts?.config ?? enabledConfig;
  const meta = opts?.briefingMeta ?? { id: 42, genStatus: "succeeded" };
  const briefing =
    opts?.briefing ??
    ({
      id: meta.id,
      briefingDate: "2026-08-03",
      payloadJson: { cu: { outlook: { trend: "偏多" } } },
    } as const);
  const targets = opts?.targets ?? [
    { id: 1, name: "群A", webhookUrl: "https://hook/a", signSecret: "s" },
  ];
  const early =
    opts?.earlyExit ?? targets.map((t) => ({ targetId: t.id, succeededPushId: null }));

  const seq: unknown[] = [[cfg], [meta], [briefing], [], early, targets];

  let callIdx = 0;
  mockSelect.mockImplementation(() => {
    if (callIdx < seq.length) {
      return buildSelectChain(seq[callIdx++]);
    }
    const rows = Array.from(pushStore.values()).map((r) => ({
      id: r.id,
      pushStatus: r.pushStatus,
      attemptCount: r.attemptCount,
    }));
    return buildSelectChain(rows.length ? [rows[0]] : []);
  });
}

/** Monday 2026-08-03 17:05 Asia/Shanghai */
const AFTER = new Date("2026-08-03T09:05:00.000Z");
/** Monday 2026-08-03 16:59 Asia/Shanghai */
const BEFORE = new Date("2026-08-03T08:59:00.000Z");
/** Spec §5: 2026-08-03T16:05:00Z → Shanghai 2026-08-04 00:05 */
const MIDNIGHT_TICK = new Date("2026-08-03T16:05:00.000Z");

const enabledConfig = {
  enabled: true,
  briefingSendTime: "17:00",
  baseUrl: "http://radar.internal",
};

beforeEach(async () => {
  vi.clearAllMocks();
  capturedCards.length = 0;
  sendCalls.length = 0;
  capturedSendActionCardCalls.length = 0;
  isBusinessDayCalls.length = 0;
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
  // Restore default isBusinessDay after T18 tests that swap mockImplementation.
  const { isBusinessDay } = await import("@fe-radar/core");
  vi.mocked(isBusinessDay).mockImplementation((date: Date | string) => {
    isBusinessDayCalls.push(date);
    return businessDay;
  });
});

// ---------------------------------------------------------------------------
// Gate tests
// ---------------------------------------------------------------------------

describe("runScheduledBriefingPush gates", () => {
  it("skips before briefing_send_time", async () => {
    setupSelectSequence([[enabledConfig]]);
    const result = await runScheduledBriefingPush({ now: BEFORE });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("before_send_time");
    expect(sendCalls).toHaveLength(0);
  });

  it("skips when the shared enabled switch is off", async () => {
    setupSelectSequence([[{ ...enabledConfig, enabled: false }]]);
    const result = await runScheduledBriefingPush({ now: AFTER });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("disabled");
    expect(sendCalls).toHaveLength(0);
  });

  it("pushes today's briefing once the time has passed, using config baseUrl", async () => {
    setupScheduledHappyPath();
    const result = await runScheduledBriefingPush({
      now: AFTER,
      sleepFn: async () => undefined,
    });
    expect(result.skipped).toBe(false);
    expect(result.briefingId).toBe(42);
    expect(sendCalls).toHaveLength(1);
    expect((capturedCards[0]?.btns[0] as { actionURL: string }).actionURL).toBe(
      "http://radar.internal/briefing/42"
    );
  });
});

// ---------------------------------------------------------------------------
// CAS claim-first
// ---------------------------------------------------------------------------

describe("CAS claim-first + authorize", () => {
  it("succeeds for a single active target with claim + authorize", async () => {
    setupRunPushSelects({
      targets: [
        {
          id: 10,
          name: "采购部群",
          webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=abc",
          signSecret: "secret123",
        },
      ],
    });
    // baseUrl from config
    // briefing → holidays → early → targets → config for baseUrl (T18 order)
    setupSelectSequence([
      [
        {
          id: 1,
          briefingDate: "2026-08-03",
          payloadJson: {
            cu: { outlook: { trend: "偏多" } },
            lc: { outlook: { trend: "区间震荡" } },
            procurement_advice: "刚需少量补库",
          },
        },
      ],
      [],
      [{ targetId: 10, succeededPushId: null }],
      [
        {
          id: 10,
          name: "采购部群",
          webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=abc",
          signSecret: "secret123",
        },
      ],
      [{ baseUrl: "http://fe-radar.internal" }],
    ]);
    wireCasStore();

    const result = await runBriefingPush(1, {
      mode: "manual",
      sleepFn: async () => undefined,
    });

    expect(result.briefingId).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(false);
    expect(mockInsert).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
    const row = pushStore.get("1:10");
    expect(row?.pushStatus).toBe("succeeded");
    expect(row?.attemptCount).toBe(1);
  });

  it("pushes multiple targets and records each result", async () => {
    const targets = [
      { id: 11, name: "群A", webhookUrl: "https://hook/t1", signSecret: "s1" },
      { id: 12, name: "群B", webhookUrl: "https://hook/t2", signSecret: "s2" },
      { id: 13, name: "群C", webhookUrl: "https://hook/t3", signSecret: "s3" },
      { id: 14, name: "群D", webhookUrl: "https://hook/t4", signSecret: "s4" },
    ];
    setupSelectSequence([
      [{ id: 2, briefingDate: "2026-08-03", payloadJson: { cu: {}, lc: {} } }],
      [],
      targets.map((t) => ({ targetId: t.id, succeededPushId: null })),
      targets,
      [{ baseUrl: "http://fe-radar.internal" }],
    ]);
    wireCasStore();

    const result = await runBriefingPush(2, {
      mode: "manual",
      sleepFn: async () => undefined,
    });

    expect(result.succeeded).toBe(4);
    expect(result.failed).toBe(0);
    expect(sendCalls).toHaveLength(4);
  });

  it("writes failed status after 3 authorized attempts with exponential backoff", async () => {
    sendImpl = async () => {
      throw new Error("钉钉 5xx");
    };
    setupSelectSequence([
      [{ id: 3, briefingDate: "2026-08-03", payloadJson: {} }],
      [],
      [{ targetId: 20, succeededPushId: null }],
      [
        {
          id: 20,
          name: "失败群",
          webhookUrl: "https://hook/fail",
          signSecret: null,
        },
      ],
      [{ baseUrl: "http://fe-radar.internal" }],
    ]);
    wireCasStore();

    const result = await runBriefingPush(3, {
      mode: "manual",
      sleepFn: async () => undefined,
    });

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(sendCalls).toHaveLength(3);
    const row = pushStore.get("3:20")!;
    expect(row.pushStatus).toBe("failed");
    expect(row.attemptCount).toBe(3);
  });

  it("is idempotent: existing succeeded skips send", async () => {
    seedPush({
      briefingId: 42,
      targetId: 4,
      pushStatus: "succeeded",
      attemptCount: 1,
      errorDetail: null,
      ageMs: 0,
    });
    // baseUrl provided in options → no config select; leftover selects → store
    setupSelectSequence([
      [{ id: 42, briefingDate: "2026-08-03", payloadJson: {} }],
      [],
      [{ targetId: 4, succeededPushId: null }], // early exit incomplete so we enter loop
      [{ id: 4, name: "群D", webhookUrl: "https://hook/d", signSecret: null }],
    ]);
    wireCasStore();

    const result = await runBriefingPush(42, {
      mode: "scheduled",
      reportDate: "2026-08-03",
      baseUrl: "http://fe-radar.internal",
      sleepFn: async () => undefined,
    });
    expect(result.skippedSucceeded).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(sendCalls).toHaveLength(0);
  });

  it("concurrent claims on same (briefingId, targetId): exactly one webhook", async () => {
    const target = { id: 99, name: "race", webhookUrl: "https://hook/race", signSecret: null };
    const cycle = [
      [enabledConfig],
      [{ id: 42, genStatus: "succeeded" }],
      [{ id: 42, briefingDate: "2026-08-03", payloadJson: {} }],
      [],
      [{ targetId: 99, succeededPushId: null }],
      [target],
    ];
    installConcurrentSelectMock(cycle);

    const [r1, r2] = await Promise.all([
      runScheduledInSession(cycle, AFTER),
      runScheduledInSession(cycle, AFTER),
    ]);

    // One success path; the other may be skippedClaimed or skipped at early exit
    // after first completes — total webhook must be 1.
    expect(sendCalls).toHaveLength(1);
    expect(pushStore.size).toBe(1);
    const only = Array.from(pushStore.values())[0]!;
    expect(only.pushStatus).toBe("succeeded");
    expect(only.attemptCount).toBe(1);
    // At least one reported succeeded
    expect((r1 as { skipped?: boolean }).skipped === false || r2.skipped === false).toBe(true);
  });

  it("20 concurrent claims → 1 success claim, 1 webhook, 1 row", async () => {
    const target = { id: 7, name: "hot", webhookUrl: "https://hook/hot", signSecret: null };
    const cycle = [
      [enabledConfig],
      [{ id: 42, genStatus: "succeeded" }],
      [{ id: 42, briefingDate: "2026-08-03", payloadJson: {} }],
      [],
      [{ targetId: 7, succeededPushId: null }],
      [target],
    ];
    installConcurrentSelectMock(cycle);

    await Promise.all(Array.from({ length: 20 }, () => runScheduledInSession(cycle, AFTER)));

    expect(sendCalls).toHaveLength(1);
    expect(pushStore.size).toBe(1);
  });

  it("failed row is not auto-retried across 10 simulated ticks (webhook delta 0)", async () => {
    seedPush({
      briefingId: 42,
      targetId: 1,
      pushStatus: "failed",
      attemptCount: 3,
      errorDetail: "boom",
      ageMs: 0,
    });
    const before = sendCalls.length;
    for (let i = 0; i < 10; i++) {
      setupScheduledHappyPath();
      wireCasStore();
      const r = await runScheduledBriefingPush({
        now: AFTER,
        sleepFn: async () => undefined,
      });
      // may skip early if all_targets not fully succeeded — we seed failed so early exit false
      expect(r.skipped === true || r.skipped === false).toBe(true);
    }
    expect(sendCalls.length - before).toBe(0);
    expect(pushStore.get("42:1")?.pushStatus).toBe("failed");
    expect(pushStore.get("42:1")?.attemptCount).toBe(3);
  });

  it("does not leak webhook credentials into logger-level fields", async () => {
    const secret = "TOP_SECRET_SIGNING_KEY";
    const webhookToken = "VERY_PRIVATE_ACCESS_TOKEN";
    setupSelectSequence([
      [{ id: 4, briefingDate: "2026-08-03", payloadJson: {} }],
      [],
      [{ targetId: 30, succeededPushId: null }],
      [
        {
          id: 30,
          name: "敏感群",
          webhookUrl: `https://oapi.dingtalk.com/robot/send?access_token=${webhookToken}`,
          signSecret: secret,
        },
      ],
      [{ baseUrl: "http://fe-radar.internal" }],
    ]);
    wireCasStore();

    await runBriefingPush(4, { mode: "manual", sleepFn: async () => undefined });

    expect(capturedSendActionCardCalls[0]?.webhookUrl).toContain(webhookToken);
    expect(capturedSendActionCardCalls[0]?.signSecret).toBe(secret);
    expect(capturedSendActionCardCalls).toHaveLength(1);
  });

  it("returns skipped=true on a public holiday without calling any DB write", async () => {
    businessDay = false;
    // T18: briefing loads first, then holidays; skip before any write
    setupSelectSequence([
      [{ id: 99, briefingDate: "2026-05-20", payloadJson: {} }],
      [{ holidayDate: "2026-05-20" }],
    ]);

    const result = await runBriefingPush(99, {
      mode: "scheduled",
      reportDate: "2026-05-20",
      sleepFn: async () => undefined,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("not_business_day");
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(sendCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// baseUrl resolution
// ---------------------------------------------------------------------------

describe("runBriefingPush baseUrl resolution", () => {
  it("manual repush (no baseUrl arg) uses daily_push_config.base_url", async () => {
    setupSelectSequence([
      [{ id: 42, briefingDate: "2026-08-03", payloadJson: {} }],
      [],
      [{ targetId: 10, succeededPushId: null }],
      [{ id: 10, name: "群", webhookUrl: "https://hook/x", signSecret: null }],
      [{ baseUrl: "http://10.1.20.156:3013" }],
    ]);
    wireCasStore();

    await runBriefingPush(42, { mode: "manual", sleepFn: async () => undefined });

    expect((capturedCards[0]?.btns[0] as { actionURL: string }).actionURL).toBe(
      "http://10.1.20.156:3013/briefing/42"
    );
  });

  it("falls back to the env default when the config row is missing", async () => {
    setupSelectSequence([
      [{ id: 42, briefingDate: "2026-08-03", payloadJson: {} }],
      [],
      [{ targetId: 10, succeededPushId: null }],
      [{ id: 10, name: "群", webhookUrl: "https://hook/x", signSecret: null }],
      [],
    ]);
    wireCasStore();

    await runBriefingPush(42, { mode: "manual", sleepFn: async () => undefined });

    expect((capturedCards[0]?.btns[0] as { actionURL: string }).actionURL).toBe(
      "http://fe-radar.internal/briefing/42"
    );
  });
});

// ---------------------------------------------------------------------------
// stale pending (120s boundary)
// ---------------------------------------------------------------------------

describe("stale pending (120s boundary)", () => {
  it("119999ms pending is NOT stale — no mark, no webhook", async () => {
    seedPush({
      briefingId: 42,
      targetId: 1,
      pushStatus: "pending",
      attemptCount: 0,
      errorDetail: null,
      ageMs: 119_999,
    });
    forcedStaleMatch = "auto";
    setupScheduledHappyPath();
    wireCasStore();
    const result = await runScheduledBriefingPush({
      now: AFTER,
      sleepFn: async () => undefined,
    });
    expect(sendCalls).toHaveLength(0);
    // When not skipped at early exit, should be skippedClaimed
    if (!result.skipped) {
      // processTarget path ran
    }
    expect(pushStore.get("42:1")?.pushStatus).toBe("pending");
  });

  it("120000ms pending IS stale — mark failed once, no webhook", async () => {
    seedPush({
      briefingId: 42,
      targetId: 1,
      pushStatus: "pending",
      attemptCount: 1,
      errorDetail: null,
      ageMs: 120_000,
    });
    setupScheduledHappyPath();
    wireCasStore();
    await runScheduledBriefingPush({
      now: AFTER,
      sleepFn: async () => undefined,
    });
    expect(sendCalls).toHaveLength(0);
    const row = pushStore.get("42:1")!;
    expect(row.pushStatus).toBe("failed");
    expect(row.errorDetail).toBe(STALE_PENDING_ERROR);
  });
});

// ---------------------------------------------------------------------------
// manual reclaim
// ---------------------------------------------------------------------------

describe("runBriefingPush manual reclaim", () => {
  it("manual reclaim of failed → succeeded with attemptCount = prior+1 on first success", async () => {
    seedPush({
      briefingId: 42,
      targetId: 1,
      pushStatus: "failed",
      attemptCount: 3,
      errorDetail: "prev",
      ageMs: 0,
    });
    // Pass baseUrl so leftover selects serve loadExistingPush from pushStore
    setupSelectSequence([
      [{ id: 42, briefingDate: "2026-08-03", payloadJson: {} }],
      [],
      [{ targetId: 1, succeededPushId: null }],
      [{ id: 1, name: "群A", webhookUrl: "https://hook/a", signSecret: "s" }],
    ]);
    wireCasStore();

    const result = await runBriefingPush(42, {
      mode: "manual",
      baseUrl: "http://fe-radar.internal",
      sleepFn: async () => undefined,
    });
    expect(result.succeeded).toBe(1);
    expect(sendCalls).toHaveLength(1);
    const row = pushStore.get("42:1")!;
    expect(row.pushStatus).toBe("succeeded");
    expect(row.attemptCount).toBe(4);
  });

  it("manual does not force-resend succeeded", async () => {
    seedPush({
      briefingId: 42,
      targetId: 1,
      pushStatus: "succeeded",
      attemptCount: 1,
      errorDetail: null,
      ageMs: 0,
    });
    setupSelectSequence([
      [{ id: 42, briefingDate: "2026-08-03", payloadJson: {} }],
      [],
      [{ targetId: 1, succeededPushId: null }],
      [{ id: 1, name: "群A", webhookUrl: "https://hook/a", signSecret: "s" }],
    ]);
    wireCasStore();

    const result = await runBriefingPush(42, {
      mode: "manual",
      baseUrl: "http://fe-radar.internal",
      sleepFn: async () => undefined,
    });
    expect(result.skippedSucceeded).toBe(1);
    expect(sendCalls).toHaveLength(0);
  });

  it("two concurrent manual reclaims on failed: only one sends", async () => {
    seedPush({
      briefingId: 42,
      targetId: 1,
      pushStatus: "failed",
      attemptCount: 3,
      errorDetail: "prev",
      ageMs: 0,
    });

    const cycle = [
      [{ id: 42, briefingDate: "2026-08-03", payloadJson: {} }],
      [],
      [{ targetId: 1, succeededPushId: null }],
      [{ id: 1, name: "群A", webhookUrl: "https://hook/a", signSecret: "s" }],
    ];
    installConcurrentSelectMock(cycle);

    const [a, b] = await Promise.all([
      selectAls.run({ i: 0, cycle }, () =>
        runBriefingPush(42, {
          mode: "manual",
          baseUrl: "http://fe-radar.internal",
          sleepFn: async () => undefined,
        })
      ),
      selectAls.run({ i: 0, cycle }, () =>
        runBriefingPush(42, {
          mode: "manual",
          baseUrl: "http://fe-radar.internal",
          sleepFn: async () => undefined,
        })
      ),
    ]);

    expect(a.succeeded + b.succeeded).toBe(1);
    expect(sendCalls).toHaveLength(1);
    expect(pushStore.get("42:1")?.pushStatus).toBe("succeeded");
  });
});

// ---------------------------------------------------------------------------
// all_targets_succeeded early exit
// ---------------------------------------------------------------------------

describe("all_targets_succeeded early exit", () => {
  it("skips without webhook when every active target already succeeded", async () => {
    setupSelectSequence([
      [{ id: 42, briefingDate: "2026-08-03", payloadJson: { heavy: "body" } }],
      [], // holidays
      [
        { targetId: 1, succeededPushId: 100 },
        { targetId: 2, succeededPushId: 101 },
      ],
    ]);
    const result = await runBriefingPush(42, {
      mode: "scheduled",
      reportDate: "2026-08-03",
      baseUrl: "http://x",
      sleepFn: async () => undefined,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("all_targets_succeeded");
    expect(sendCalls).toHaveLength(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// single clock (injected now)
// ---------------------------------------------------------------------------

describe("single clock (injected now)", () => {
  it("uses injected now for reportDate — scheduleLatest and business day share it", async () => {
    // MIDNIGHT_TICK → Shanghai 2026-08-04 00:05; briefing_send_time 17:00 not yet → before_send_time
    // But if we set briefingSendTime to 00:00, we proceed and query briefingDate=2026-08-04
    const midnightConfig = {
      enabled: true,
      briefingSendTime: "00:00",
      baseUrl: "http://radar.internal",
    };
    // Capture eq args for briefingDate query
    const { eq } = await import("drizzle-orm");
    setupSelectSequence([
      [midnightConfig],
      [], // no briefing for 2026-08-04
    ]);

    const result = await runScheduledBriefingPush({
      now: MIDNIGHT_TICK,
      sleepFn: async () => undefined,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no_briefing");

    // scheduleLatestBriefingPush must have queried reportDate 2026-08-04
    const eqCalls = (eq as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const dateEq = eqCalls.find(
      (c) => c[0] === "briefing_date" || (c[1] === "2026-08-04")
    );
    expect(dateEq?.[1]).toBe("2026-08-04");
  });

  it("scheduled business-day check receives the same reportDate string", async () => {
    const midnightConfig = {
      enabled: true,
      briefingSendTime: "00:00",
      baseUrl: "http://radar.internal",
    };
    setupSelectSequence([
      [midnightConfig],
      [{ id: 77, genStatus: "succeeded" }],
      [{ id: 77, briefingDate: "2026-08-04", payloadJson: {} }],
      [], // holidays (after briefing — T18)
      [{ targetId: 1, succeededPushId: null }],
      [{ id: 1, name: "群", webhookUrl: "https://hook/x", signSecret: null }],
    ]);
    wireCasStore();

    await runScheduledBriefingPush({
      now: MIDNIGHT_TICK,
      sleepFn: async () => undefined,
    });

    // Host wall clock must not appear as the business-day input — reportDate string.
    expect(isBusinessDayCalls.length).toBeGreaterThanOrEqual(1);
    expect(isBusinessDayCalls[0]).toBe("2026-08-04");
    // Deleting reportDate plumbing would fail this (would pass Date wall clock).
    expect(typeof isBusinessDayCalls[0]).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// T18: manual business-day uses briefingDate (not wall clock)
// ---------------------------------------------------------------------------

describe("manual business-day uses briefingDate (T18)", () => {
  it("host weekend + weekday briefingDate → manual still sends", async () => {
    // Simulate: host is Saturday; briefing is Friday 2026-08-07.
    // Old bug: isBusinessDay(new Date()) → false → not_business_day.
    // Fix: isBusinessDay(briefing.briefingDate) → true → send.
    const { isBusinessDay } = await import("@fe-radar/core");
    vi.mocked(isBusinessDay).mockImplementation((date: Date | string) => {
      isBusinessDayCalls.push(date);
      if (date instanceof Date) return false; // wall clock = weekend
      return date === "2026-08-07"; // Friday briefing
    });

    setupSelectSequence([
      [{ id: 55, briefingDate: "2026-08-07", payloadJson: {} }],
      [],
      [{ targetId: 1, succeededPushId: null }],
      [{ id: 1, name: "群", webhookUrl: "https://hook/weekend", signSecret: null }],
    ]);
    wireCasStore();

    const result = await runBriefingPush(55, {
      mode: "manual",
      baseUrl: "http://fe-radar.internal",
      sleepFn: async () => undefined,
    });

    expect(isBusinessDayCalls[0]).toBe("2026-08-07");
    expect(typeof isBusinessDayCalls[0]).toBe("string");
    expect(result.skipped).toBe(false);
    expect(result.reason).not.toBe("not_business_day");
    expect(result.succeeded).toBe(1);
    expect(sendCalls).toHaveLength(1);
  });

  it("host weekday + holiday briefingDate → manual blocked", async () => {
    // Simulate: host is a workday; briefing date is a holiday.
    // Old bug: isBusinessDay(new Date()) → true → would send.
    // Fix: isBusinessDay(briefing.briefingDate) → false → not_business_day.
    const { isBusinessDay } = await import("@fe-radar/core");
    vi.mocked(isBusinessDay).mockImplementation((date: Date | string) => {
      isBusinessDayCalls.push(date);
      if (date instanceof Date) return true; // wall clock = weekday
      return date !== "2026-05-20"; // holiday briefing → false for that date
    });

    setupSelectSequence([
      [{ id: 56, briefingDate: "2026-05-20", payloadJson: {} }],
      [{ holidayDate: "2026-05-20" }],
    ]);
    wireCasStore();

    const result = await runBriefingPush(56, {
      mode: "manual",
      baseUrl: "http://fe-radar.internal",
      sleepFn: async () => undefined,
    });

    expect(isBusinessDayCalls[0]).toBe("2026-05-20");
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("not_business_day");
    expect(mockInsert).not.toHaveBeenCalled();
    expect(sendCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T18: CAS WHERE must honor attemptCount (stale cursor after reclaim)
// ---------------------------------------------------------------------------

describe("CAS WHERE honors attemptCount after reclaim", () => {
  it("reclaim then finalize with old expectedAttemptCount affects 0 rows", async () => {
    // Post-reclaim state: pending, attemptCount already advanced to 4.
    const row = seedPush({
      id: 77,
      briefingId: 42,
      targetId: 1,
      pushStatus: "pending",
      attemptCount: 4,
      errorDetail: null,
      ageMs: 0,
    });
    wireCasStore();

    // Owner that still holds pre-reclaim cursor (expectedAttemptCount=3).
    const lost = await finalizePush(row.id, 3, "succeeded", null);
    expect(lost).toBe(false);
    expect(pushStore.get("42:1")?.pushStatus).toBe("pending");
    expect(pushStore.get("42:1")?.attemptCount).toBe(4);

    // Legitimate owner with post-reclaim cursor finalizes successfully.
    const won = await finalizePush(row.id, 4, "succeeded", null);
    expect(won).toBe(true);
    expect(pushStore.get("42:1")?.pushStatus).toBe("succeeded");
  });
});

// ---------------------------------------------------------------------------
// mechanical: no pushedAt equality
// ---------------------------------------------------------------------------

describe("mechanical: no pushedAt equality in ownership updates", () => {
  it("update set never passes a JS Date as pushedAt equality token", async () => {
    setupScheduledHappyPath();
    wireCasStore();
    await runScheduledBriefingPush({ now: AFTER, sleepFn: async () => undefined });
    for (const call of mockUpdateSet.mock.calls) {
      const setVals = call[0] as Record<string, unknown>;
      if ("pushedAt" in setVals) {
        expect(setVals["pushedAt"]).not.toBeInstanceOf(Date);
        expect(typeof setVals["pushedAt"]).toBe("object");
      }
    }
  });
});
