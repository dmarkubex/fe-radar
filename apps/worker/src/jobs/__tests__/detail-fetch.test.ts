import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  runDetailFetch: vi.fn(),
  eq: vi.fn((a: unknown, b: unknown) => ({ a, b }))
}));

vi.mock("@fe-radar/db", () => ({
  getDb: mocks.getDb,
  itemAnalysis: {
    itemId: "item_analysis.item_id",
    isCurated: "item_analysis.is_curated",
    alertType: "item_analysis.alert_type"
  }
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq
}));

vi.mock("../../internal/fulltext", () => ({
  runDetailFetch: mocks.runDetailFetch
}));

vi.mock("@fe-radar/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

import { handleDetailFetchJob } from "../detail-fetch";

function makeDb(rows: Array<{ isCurated: boolean; alertType: string | null }>): void {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  mocks.getDb.mockReturnValue({
    select: vi.fn().mockReturnValue({ from })
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runDetailFetch.mockResolvedValue({
    ok: true,
    itemId: 42,
    content: "x".repeat(80),
    truncated: false,
    source: "fetched"
  });
});

describe("handleDetailFetchJob", () => {
  it("skips when item_analysis is missing", async () => {
    makeDb([]);
    await handleDetailFetchJob(42);
    expect(mocks.runDetailFetch).not.toHaveBeenCalled();
  });

  it("skips when not curated and alert_type is outside the allow-list", async () => {
    makeDb([{ isCurated: false, alertType: "noise" }]);
    await handleDetailFetchJob(42);
    expect(mocks.runDetailFetch).not.toHaveBeenCalled();
  });

  it("calls shared runDetailFetch when is_curated", async () => {
    makeDb([{ isCurated: true, alertType: null }]);
    await handleDetailFetchJob(42);
    expect(mocks.runDetailFetch).toHaveBeenCalledTimes(1);
    expect(mocks.runDetailFetch).toHaveBeenCalledWith(42);
  });

  it("calls shared runDetailFetch when alert_type is own", async () => {
    makeDb([{ isCurated: false, alertType: "own" }]);
    await handleDetailFetchJob(7);
    expect(mocks.runDetailFetch).toHaveBeenCalledWith(7);
  });

  it("persists via runDetailFetch (fake extract) so item_fulltext is written", async () => {
    const persisted: number[] = [];
    mocks.runDetailFetch.mockImplementation(async (itemId: number) => {
      persisted.push(itemId);
      return {
        ok: true,
        itemId,
        content: "stored-from-job",
        truncated: false,
        source: "fetched"
      };
    });
    makeDb([{ isCurated: true, alertType: "risk" }]);
    await handleDetailFetchJob(99);
    expect(persisted).toEqual([99]);
  });
});
