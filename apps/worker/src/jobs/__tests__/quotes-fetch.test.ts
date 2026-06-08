import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted() runs before module resolution
// ---------------------------------------------------------------------------

const {
  mockGetDb,
  mockListSources,
  mockMarkSourceFailure,
  mockMarkSourceSuccess,
  mockExecute,
  mockFetchQuotes,
  mockIsBusinessDay,
} = vi.hoisted(() => {
  const mockExecute = vi.fn().mockResolvedValue(undefined);
  const mockGetDb = vi.fn();
  const mockListSources = vi.fn();
  const mockMarkSourceFailure = vi.fn().mockResolvedValue(undefined);
  const mockMarkSourceSuccess = vi.fn().mockResolvedValue(undefined);
  const mockFetchQuotes = vi.fn();
  const mockIsBusinessDay = vi.fn();
  return { mockGetDb, mockListSources, mockMarkSourceFailure, mockMarkSourceSuccess, mockExecute, mockFetchQuotes, mockIsBusinessDay };
});

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  listSources: mockListSources,
  markSourceFailure: mockMarkSourceFailure,
  markSourceSuccess: mockMarkSourceSuccess,
  commodityQuotes: {},
  briefingHolidays: { holidayDate: "holiday_date" },
}));

vi.mock("../../fetchers/quotes", () => ({
  fetchQuotes: mockFetchQuotes,
}));

vi.mock("@fe-radar/core", () => ({
  isBusinessDay: mockIsBusinessDay,
}));

vi.mock("@fe-radar/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock drizzle-orm sql tag to return a string for inspection
vi.mock("drizzle-orm", () => ({
  sql: new Proxy(
    Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const parts: string[] = [];
        strings.forEach((s, i) => {
          parts.push(s);
          if (i < values.length) parts.push(String(values[i]));
        });
        return parts.join("");
      },
      { raw: (s: string) => s }
    ),
    {
      get(target, prop) {
        if (prop === "raw") return (s: string) => s;
        return (target as unknown as Record<string | symbol, unknown>)[prop];
      },
      apply(target, _thisArg, args) {
        return (target as (...fnArgs: unknown[]) => string)(...args);
      },
    }
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDbWithHolidays(holidayRows: { holidayDate: string }[]) {
  const db = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockResolvedValue(holidayRows),
    execute: mockExecute,
  };
  mockGetDb.mockReturnValue(db);
  return db;
}

function makeSource(overrides: Partial<{
  id: number;
  name: string;
  tier: string;
  fetcherType: string;
  enabled: boolean;
  failCount: number;
  config: unknown;
}> = {}) {
  return {
    id: 1,
    name: "shfe-copper",
    tier: "T1",
    fetcherType: "quotes",
    enabled: true,
    failCount: 0,
    config: { adapter: "shfe" },
    ...overrides,
  };
}

function makeSample(overrides: Partial<{
  metricKey: string;
  value: number | null;
  rawText: string;
  observedAt: Date;
}> = {}) {
  return {
    metricKey: "cu.shfe.main",
    value: 68450,
    rawText: "铜主力 68450",
    observedAt: new Date("2026-05-19T07:30:00.000Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { runQuotesFetch } from "../quotes-fetch";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runQuotesFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);
    mockMarkSourceFailure.mockResolvedValue(undefined);
    mockMarkSourceSuccess.mockResolvedValue(undefined);
  });

  it("skips on holidays: isBusinessDay=false → does not call fetchQuotes", async () => {
    makeDbWithHolidays([{ holidayDate: "2026-05-20" }]);
    mockIsBusinessDay.mockReturnValue(false);

    const result = await runQuotesFetch(1);

    expect(result.skipped).toBe(true);
    expect(result.upserted).toBe(0);
    expect(mockFetchQuotes).not.toHaveBeenCalled();
    expect(mockMarkSourceFailure).not.toHaveBeenCalled();
  });

  it("normal enqueue: fetchQuotes returns QuoteSample[] → upserted correctly + markSourceSuccess", async () => {
    makeDbWithHolidays([]);
    mockIsBusinessDay.mockReturnValue(true);
    const source = makeSource();
    mockListSources.mockResolvedValue([source]);
    const samples = [makeSample(), makeSample({ metricKey: "cu.shfe.inventory", value: 12300 })];
    mockFetchQuotes.mockResolvedValue(samples);

    const result = await runQuotesFetch(1);

    expect(result.skipped).toBe(false);
    expect(result.upserted).toBe(2);
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(mockMarkSourceSuccess).toHaveBeenCalledWith(expect.anything(), 1);
    expect(mockMarkSourceFailure).not.toHaveBeenCalled();
  });

  it("adapter failure: fetchQuotes throws → markSourceFailure increments fail_count", async () => {
    makeDbWithHolidays([]);
    mockIsBusinessDay.mockReturnValue(true);
    const source = makeSource({ failCount: 2 });
    mockListSources.mockResolvedValue([source]);
    mockFetchQuotes.mockRejectedValue(new Error("network timeout"));

    await expect(runQuotesFetch(1)).rejects.toThrow("network timeout");

    expect(mockMarkSourceFailure).toHaveBeenCalledWith(
      expect.anything(),
      1,
      3,     // nextFail = 2+1
      false, // not yet at threshold
      expect.stringContaining("network timeout") // lastError reason
    );
    expect(mockMarkSourceSuccess).not.toHaveBeenCalled();
  });

  it("upsert conflict: SQL contains ON CONFLICT ... DO UPDATE for each sample", async () => {
    makeDbWithHolidays([]);
    mockIsBusinessDay.mockReturnValue(true);
    const source = makeSource();
    mockListSources.mockResolvedValue([source]);
    const observedAt = new Date("2026-05-19T07:30:00.000Z");
    mockFetchQuotes.mockResolvedValue([
      makeSample({ metricKey: "cu.shfe.main", value: 68500, observedAt }),
    ]);

    const result = await runQuotesFetch(1);

    expect(result.upserted).toBe(1);
    // The SQL string passed to execute must contain tier-priority ON CONFLICT clause
    const sqlArg = mockExecute.mock.calls[0]?.[0] as string;
    expect(sqlArg).toContain("ON CONFLICT");
    expect(sqlArg).toContain("DO UPDATE");
    expect(sqlArg).toContain("WHERE");
  });

  // ── T-CB-09 v0.4 fix M3 — tier-priority upsert (cases a / b / c) ───────
  // The upsert inlines the incoming source's tier number into a
  // `WHERE <incomingTier> <= (existing source tier)` guard, so a lower-priority
  // source can never overwrite a higher-priority one. The mocked sql tag
  // materialises the generated SQL string for inspection.

  it("tier priority (case a): T1 incoming emits `1 <= existing` guard → overwrites lower tiers", async () => {
    makeDbWithHolidays([]);
    mockIsBusinessDay.mockReturnValue(true);
    mockListSources.mockResolvedValue([makeSource({ id: 1, name: "shfe-cu", tier: "T1" })]);
    mockFetchQuotes.mockResolvedValue([makeSample({ metricKey: "cu_main_close", value: 68450 })]);

    await runQuotesFetch(1);

    const sqlArg = mockExecute.mock.calls[0]?.[0] as string;
    expect(sqlArg).toContain("ON CONFLICT (metric_key, observed_at) DO UPDATE");
    // incoming T1 → tierNum 1; 1 <= existing(1|2|3) always true → T1 wins
    expect(sqlArg).toMatch(/WHERE\s+1\s*<=/);
    expect(sqlArg).toContain("WHEN 'T1' THEN 1");
  });

  it("tier priority (case b): T2 incoming emits `2 <= existing` guard → cannot overwrite T1", async () => {
    makeDbWithHolidays([]);
    mockIsBusinessDay.mockReturnValue(true);
    mockListSources.mockResolvedValue([makeSource({ id: 2, name: "smm-cu", tier: "T2" })]);
    mockFetchQuotes.mockResolvedValue([makeSample({ metricKey: "cu_main_close", value: 68500 })]);

    await runQuotesFetch(2);

    const sqlArg = mockExecute.mock.calls[0]?.[0] as string;
    // incoming T2 → tierNum 2; against an existing T1 row `2 <= 1` is false → T1 preserved
    expect(sqlArg).toMatch(/WHERE\s+2\s*<=/);
  });

  it("tier priority (case c): same-tier (T1 over T1) emits `1 <= existing` guard → last-write-wins", async () => {
    makeDbWithHolidays([]);
    mockIsBusinessDay.mockReturnValue(true);
    mockListSources.mockResolvedValue([makeSource({ id: 3, name: "shfe-cu-mirror", tier: "T1" })]);
    mockFetchQuotes.mockResolvedValue([makeSample({ metricKey: "cu_main_close", value: 68550 })]);

    await runQuotesFetch(3);

    const sqlArg = mockExecute.mock.calls[0]?.[0] as string;
    // incoming T1 vs existing T1 → `1 <= 1` true → newer write replaces value + source_id
    expect(sqlArg).toMatch(/WHERE\s+1\s*<=/);
    expect(sqlArg).toContain("EXCLUDED.source_id");
  });

  it("consecutive 7 failures: markSourceFailure called with disable=true on 7th failure", async () => {
    makeDbWithHolidays([]);
    mockIsBusinessDay.mockReturnValue(true);
    // failCount already at 6 → 7th consecutive failure triggers disable
    const source = makeSource({ failCount: 6 });
    mockListSources.mockResolvedValue([source]);
    mockFetchQuotes.mockRejectedValue(new Error("timeout"));

    await expect(runQuotesFetch(1)).rejects.toThrow("timeout");

    expect(mockMarkSourceFailure).toHaveBeenCalledWith(
      expect.anything(),
      1,
      7,    // nextFail = 6+1
      true, // disable=true at threshold
      expect.stringContaining("timeout") // lastError reason
    );
  });

  it("all-null quote samples are upserted but counted as source failure for NFR-104", async () => {
    makeDbWithHolidays([]);
    mockIsBusinessDay.mockReturnValue(true);
    const source = makeSource({ failCount: 2 });
    mockListSources.mockResolvedValue([source]);
    mockFetchQuotes.mockResolvedValue([
      makeSample({ metricKey: "lc_spot_smm", value: null, rawText: "今日未命中价格" }),
    ]);

    const result = await runQuotesFetch(1);

    expect(result.upserted).toBe(1);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockMarkSourceFailure).toHaveBeenCalledWith(
      expect.anything(),
      1,
      3,
      false,
      expect.stringContaining("空值") // lastError reason (all-null samples)
    );
    expect(mockMarkSourceSuccess).not.toHaveBeenCalled();
  });
});
