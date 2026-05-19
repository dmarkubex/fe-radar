import { describe, expect, it, vi } from "vitest";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";
import { retentionCutoff, runCleanup } from "../cleanup";

describe("cleanup retentionCutoff", () => {
  it("computes the 90-day retention cutoff in Asia/Shanghai", () => {
    const cutoff = retentionCutoff(new Date("2026-05-11T00:00:00Z"));
    expect(cutoff.date).toBe(
      dayjs("2026-05-11T00:00:00Z").tz(APP_TIMEZONE).subtract(90, "day").format("YYYY-MM-DD")
    );
  });
});

describe("cleanup runCleanup commodity extensions (T-CB-15)", () => {
  type DeleteResult = ReadonlyArray<{ id: number; date?: string }>;

  function makeFakeDb(returnSequence: DeleteResult[]) {
    const calls: DeleteResult[] = [];
    let idx = 0;
    const chain = {
      delete: (_table: unknown) => chain,
      where: (_cond: unknown) => chain,
      returning: (_cols: unknown) => {
        const rows = returnSequence[idx] ?? [];
        idx += 1;
        calls.push(rows);
        return Promise.resolve(rows);
      }
    };
    return {
      transaction: async <T>(fn: (tx: typeof chain) => Promise<T>) => fn(chain),
      __calls: calls
    } as unknown as Parameters<typeof runCleanup>[0] & { __calls: DeleteResult[] };
  }

  it("returns counts for v1.0 + v1.1 tables in CleanupResult", async () => {
    const db = makeFakeDb([
      [{ id: 1, date: "2026-01-01" }],
      [{ id: 11 }, { id: 12 }],
      [{ id: 21 }],
      [{ id: 31 }, { id: 32 }, { id: 33 }],
      [{ id: 41 }]
    ]);
    const result = await runCleanup(db, new Date("2026-05-19T00:00:00Z"));
    expect(result).toEqual({
      deletedItems: 2,
      deletedDailyReports: 1,
      deletedStaleClusters: 1,
      deletedCommodityQuotes: 3,
      deletedCommodityBriefings: 1
    });
  });

  it("handles empty results across all DELETEs", async () => {
    const db = makeFakeDb([[], [], [], [], []]);
    const result = await runCleanup(db, new Date("2026-05-19T00:00:00Z"));
    expect(result.deletedCommodityQuotes).toBe(0);
    expect(result.deletedCommodityBriefings).toBe(0);
  });

  it("propagates transaction errors (rollback semantics rely on db.transaction)", async () => {
    const db = {
      transaction: vi.fn(async () => {
        throw new Error("simulated rollback");
      })
    } as unknown as Parameters<typeof runCleanup>[0];
    await expect(runCleanup(db)).rejects.toThrow("simulated rollback");
  });
});
