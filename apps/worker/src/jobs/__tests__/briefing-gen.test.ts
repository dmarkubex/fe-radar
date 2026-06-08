import { describe, expect, it, vi, beforeEach } from "vitest";
import { runBriefingGen, KEY_METRIC_FIELDS } from "../briefing-gen";

// ─────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────

// Module-level nullable fn refs — same pattern as daily-gen.test.ts.
// Use single-unknown-param signatures so optional-call + spread compiles.
let llmRunBriefingGenFn: ((input: unknown) => Promise<unknown>) | null = null;
let llmBuildBriefingInputFn: ((a: unknown, b?: unknown, c?: unknown) => unknown) | null = null;
let coreComputeSRFn: ((a: unknown) => unknown) | null = null;
let coreIsBusinessDayFn: ((a: unknown, b?: unknown) => unknown) | null = null;
let coreDegradeFieldsFn: ((a: unknown, b?: unknown) => unknown) | null = null;
let renderBriefingFn: ((payload: unknown, db: unknown) => Promise<unknown>) | null = null;

vi.mock("@fe-radar/llm", async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return {
    ...mod,
    runBriefingGen: (input: unknown) => llmRunBriefingGenFn?.(input),
    buildBriefingInput: (a: unknown, b?: unknown, c?: unknown) => llmBuildBriefingInputFn?.(a, b, c),
  };
});

vi.mock("@fe-radar/core", async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return {
    ...mod,
    isBusinessDay: (a: unknown, b?: unknown) => coreIsBusinessDayFn?.(a, b),
    computeSupportResistance: (a: unknown) => coreComputeSRFn?.(a),
    degradeFields: (a: unknown, b?: unknown) => coreDegradeFieldsFn?.(a, b),
  };
});

vi.mock("../../lib/briefing-render", () => ({
  renderBriefing: (payload: unknown, db: unknown) => renderBriefingFn?.(payload, db),
}));

// Shared spies so tests can assert briefing-push enqueue. Declared via
// vi.hoisted so they exist before the hoisted vi.mock factory runs.
const { pushQueueAdd, pushQueueClose } = vi.hoisted(() => ({
  pushQueueAdd: vi.fn().mockResolvedValue(undefined),
  pushQueueClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../queues", () => ({
  QUEUE_QUOTES_FETCH: "fe-quotes-fetch",
  createRedisConnection: vi.fn().mockReturnValue({}),
  createBriefingPushQueue: vi.fn().mockReturnValue({
    add: pushQueueAdd,
    close: pushQueueClose,
  }),
}));

// ─────────────────────────────────────────────────────────────
// DB mock helpers
// ─────────────────────────────────────────────────────────────

/**
 * Build a chainable Drizzle select mock that resolves to `rows`.
 * Every terminal step (.from / .where / .limit) returns a Promise so that
 * queries that don't call .limit() (e.g. loadHolidaySet) still get `rows`.
 */
function mockSelect(rows: unknown[] = []) {
  // A thenable chain: every method returns the chain AND the chain itself is
  // thenable (has a .then method that resolves to rows).
  const chain: Record<string, unknown> = {};
  const makeMethod = () => vi.fn().mockReturnValue(chain);
  chain.from = makeMethod();
  chain.where = makeMethod();
  chain.innerJoin = makeMethod();
  chain.orderBy = makeMethod();
  chain.limit = vi.fn().mockResolvedValue(rows);
  // Make the chain itself awaitable — resolves to `rows`
  chain.then = (resolve: (v: unknown) => void) => resolve(rows);
  return { select: vi.fn().mockReturnValue(chain) };
}

function mockInsertChain(returnRows: unknown[] = [{ id: 42 }]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.values = vi.fn().mockReturnValue(chain);
  chain.onConflictDoNothing = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(returnRows);
  return chain;
}

/** Minimal DB stub used across most tests.
 *  Uses thenable select chain so both .limit() and direct-await queries work.
 */
function buildDb(overrides: Partial<Record<string, unknown>> = {}) {
  const { select } = mockSelect([]);
  const insertChain = mockInsertChain([{ id: 42 }]);
  return {
    select,
    insert: vi.fn().mockReturnValue(insertChain),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────

describe("briefing-gen", () => {
  // Reset mocks before each test — reassign fresh vi.fn() instances so that
  // .mockResolvedValue / .mockReturnValue are available, and the factory
  // wrappers pick them up via the module-level let variables.
  beforeEach(() => {
    // Default: LLM returns valid 7-segment output
    llmRunBriefingGenFn = vi.fn().mockResolvedValue({
      value: {
        cu: { logic_summary: "CU 供需偏紧", outlook: { trend: "偏多" } },
        lc: { logic_summary: "LC 去库存", outlook: { trend: "区间震荡" } },
        macro_summary: "宏观偏中性",
        risk_notes: ["美联储加息风险"],
        procurement_advice: "刚需少量补库，大批量采购暂缓",
      },
      usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200, costCny: 0.01 },
      provider: "kimi",
    });
    llmBuildBriefingInputFn = vi.fn().mockReturnValue("mocked-briefing-input");

    // Default: s/r returns valid integers
    coreComputeSRFn = vi.fn().mockReturnValue({ support: 75000, resistance: 80000 });
    coreIsBusinessDayFn = vi.fn().mockReturnValue(true);
    coreDegradeFieldsFn = vi.fn().mockReturnValue({ ok: true, missing: [] });

    // Default: render succeeds
    renderBriefingFn = vi.fn().mockResolvedValue({
      docxPath: "fe-radar-briefings/briefings/2026/05/briefing-20260520.docx",
      minioKey: "briefings/2026/05/briefing-20260520.docx",
    });
  });

  // ── Drift guard (Antigravity #3): coverage keys must match seed metric_keys ──
  it("KEY_METRIC_FIELDS use canonical seed metric_key names, not the buggy aliases", () => {
    expect(KEY_METRIC_FIELDS).toEqual([
      "cu_main_close",
      "cu_change_pct",
      "lc_main_close",
      "lc_change_pct",
      "fx_usdcny",
    ]);
    // The old values silently broke coverage — guard against regression.
    for (const bad of ["cu_main_change_pct", "lc_main_change_pct", "usd_cny"]) {
      expect(KEY_METRIC_FIELDS).not.toContain(bad);
    }
  });

  // ── Case 1: quotes-fetch queue non-empty → delay × 2 → abort failed ────
  it("aborts with gen_status=failed when quotes-fetch queue is non-empty after max retries", async () => {
    const db = buildDb();

    // Queue always reports pending jobs
    const mockQueue = {
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 2, active: 1, delayed: 0 }),
    };

    const result = await runBriefingGen({
      db: db as never,
      now: new Date("2026-05-20T08:00:00Z"),
      quotesFetchQueueOverride: mockQueue,
      retryDelayMs: 0, // no actual sleep in tests
    });

    expect(result.status).toBe("failed");
    expect(result.genError).toMatch(/quotes-fetch queue non-empty/i);
    // Should have been called: initial check + 2 retries = 3 total
    expect(mockQueue.getJobCounts).toHaveBeenCalledTimes(3);
    // LLM should NOT have been called
    expect(llmRunBriefingGenFn).not.toHaveBeenCalled();
  });

  // ── Case 2: queue empty on retry 1 → no abort ─────────────────────────
  it("proceeds after queue empties on second check", async () => {
    const db = buildDb();

    // First call: non-empty; second call: empty
    const mockQueue = {
      getJobCounts: vi.fn()
        .mockResolvedValueOnce({ waiting: 1, active: 0, delayed: 0 })
        .mockResolvedValueOnce({ waiting: 0, active: 0, delayed: 0 }),
    };

    const result = await runBriefingGen({
      db: db as never,
      now: new Date("2026-05-20T08:00:00Z"),
      quotesFetchQueueOverride: mockQueue,
      retryDelayMs: 0,
    });

    // Should not fail at the queue check step
    expect(mockQueue.getJobCounts).toHaveBeenCalledTimes(2);
    // Should have called LLM
    expect(llmRunBriefingGenFn).toHaveBeenCalledOnce();
    expect(["succeeded", "degraded"]).toContain(result.status);
  });

  // ── Case 3: field coverage insufficient → degraded ─────────────────────
  it("returns gen_status=degraded when fewer than 5 key fields are present after retries", async () => {
    // Patch degradeFields to return missing fields
    coreDegradeFieldsFn = vi.fn().mockReturnValue({
      ok: false,
      missing: ["cu_main_close", "lc_main_close"],
    });

    const db = buildDb();
    const mockQueue = {
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0 }),
    };

    const result = await runBriefingGen({
      db: db as never,
      now: new Date("2026-05-20T08:00:00Z"),
      quotesFetchQueueOverride: mockQueue,
      retryDelayMs: 0,
    });

    expect(result.status).toBe("degraded");
    expect(result.briefingId).toBe(42);
  });

  // ── Case 4: normal success with s/r injected ───────────────────────────
  it("returns gen_status=succeeded and injects integer support/resistance into payload", async () => {
    const capturedPayloads: unknown[] = [];
    const insertChain: Record<string, ReturnType<typeof vi.fn>> = {};
    insertChain.values = vi.fn().mockImplementation((val: unknown) => {
      capturedPayloads.push(val);
      return insertChain;
    });
    insertChain.onConflictDoNothing = vi.fn().mockReturnValue(insertChain);
    insertChain.returning = vi.fn().mockResolvedValue([{ id: 99 }]);

    const db = { ...buildDb(), insert: vi.fn().mockReturnValue(insertChain) };

    const mockQueue = {
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0 }),
    };

    const result = await runBriefingGen({
      db: db as never,
      now: new Date("2026-05-20T08:00:00Z"),
      quotesFetchQueueOverride: mockQueue,
      retryDelayMs: 0,
    });

    expect(result.status).toBe("succeeded");
    expect(result.briefingId).toBe(99);
    expect(result.docxPath).toContain("briefing-");

    // Verify payload_json contains injected s/r
    const payload = (capturedPayloads[0] as Record<string, unknown>)
      ?.payloadJson as Record<string, unknown>;
    expect(payload).toBeDefined();
    const cuOutlook = (payload["cu"] as Record<string, unknown>)?.["outlook"] as Record<string, unknown>;
    expect(cuOutlook?.["support"]).toBe(75000);
    expect(cuOutlook?.["resistance"]).toBe(80000);
    const lcOutlook = (payload["lc"] as Record<string, unknown>)?.["outlook"] as Record<string, unknown>;
    expect(lcOutlook?.["support"]).toBe(75000);
    expect(lcOutlook?.["resistance"]).toBe(80000);
  });

  // ── Case 5: s/r null when sample < 10 → payload fields null + _srDegraded ─
  it("sets support/resistance to null and marks _srDegraded when sample < 10", async () => {
    // Override computeSupportResistance to return null (< 10 samples)
    coreComputeSRFn = vi.fn().mockReturnValue({ support: null, resistance: null });

    const capturedPayloads: unknown[] = [];
    const insertChain: Record<string, ReturnType<typeof vi.fn>> = {};
    insertChain.values = vi.fn().mockImplementation((val: unknown) => {
      capturedPayloads.push(val);
      return insertChain;
    });
    insertChain.onConflictDoNothing = vi.fn().mockReturnValue(insertChain);
    insertChain.returning = vi.fn().mockResolvedValue([{ id: 77 }]);

    const db = { ...buildDb(), insert: vi.fn().mockReturnValue(insertChain) };

    const mockQueue = {
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0 }),
    };

    const result = await runBriefingGen({
      db: db as never,
      now: new Date("2026-05-20T08:00:00Z"),
      quotesFetchQueueOverride: mockQueue,
      retryDelayMs: 0,
    });

    expect(result.status).toBe("succeeded");

    const payload = (capturedPayloads[0] as Record<string, unknown>)
      ?.payloadJson as Record<string, unknown>;
    const cuOutlook = (payload["cu"] as Record<string, unknown>)?.["outlook"] as Record<string, unknown>;
    expect(cuOutlook?.["support"]).toBeNull();
    expect(cuOutlook?.["resistance"]).toBeNull();

    // _srDegraded flag must be present
    expect(payload["_srDegraded"]).toBe(true);

    // docx template field for support should be "—" (flat placeholder keys
    // matching briefing_template_fields.placeholder_key)
    expect(renderBriefingFn).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({
          cu_support: "—",
          cu_resistance: "—",
        }),
      }),
      expect.anything()
    );
  });

  // ── Case 7: enqueue briefing-push on success (T-CB-13 / FIX-2) ─────────
  it("enqueues a briefing-push job after a successful generation", async () => {
    pushQueueAdd.mockClear();
    pushQueueClose.mockClear();

    const insertChain: Record<string, ReturnType<typeof vi.fn>> = {};
    insertChain.values = vi.fn().mockReturnValue(insertChain);
    insertChain.onConflictDoNothing = vi.fn().mockReturnValue(insertChain);
    insertChain.returning = vi.fn().mockResolvedValue([{ id: 88 }]);

    const db = { ...buildDb(), insert: vi.fn().mockReturnValue(insertChain) };

    const mockQueue = {
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0 }),
    };

    const result = await runBriefingGen({
      db: db as never,
      now: new Date("2026-05-20T08:00:00Z"),
      quotesFetchQueueOverride: mockQueue,
      retryDelayMs: 0,
    });

    expect(result.status).toBe("succeeded");
    expect(result.briefingId).toBe(88);
    // briefing-push enqueued with the persisted briefingId, then connection closed
    expect(pushQueueAdd).toHaveBeenCalledWith("briefing-push", { briefingId: 88 });
    expect(pushQueueClose).toHaveBeenCalledOnce();
  });

  // ── Case 6: LLM error → gen_status=failed + gen_error text ────────────
  it("returns gen_status=failed and records gen_error when LLM throws", async () => {
    llmRunBriefingGenFn = vi.fn().mockRejectedValue(new Error("Kimi timeout"));

    const capturedInserts: unknown[] = [];
    const insertChain: Record<string, ReturnType<typeof vi.fn>> = {};
    insertChain.values = vi.fn().mockImplementation((val: unknown) => {
      capturedInserts.push(val);
      return insertChain;
    });
    insertChain.onConflictDoNothing = vi.fn().mockReturnValue(insertChain);
    insertChain.returning = vi.fn().mockResolvedValue([{ id: 55 }]);

    const db = { ...buildDb(), insert: vi.fn().mockReturnValue(insertChain) };

    const mockQueue = {
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0 }),
    };

    const result = await runBriefingGen({
      db: db as never,
      now: new Date("2026-05-20T08:00:00Z"),
      quotesFetchQueueOverride: mockQueue,
      retryDelayMs: 0,
    });

    expect(result.status).toBe("failed");
    expect(result.genError).toContain("Kimi timeout");

    // Verify gen_error was persisted to DB
    const inserted = capturedInserts[0] as Record<string, unknown>;
    expect(inserted?.["genStatus"]).toBe("failed");
    expect(inserted?.["genError"]).toContain("Kimi timeout");

    // docx render should NOT have been called
    expect(renderBriefingFn).not.toHaveBeenCalled();
  });
});
