import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  copilotAuditLog,
  copilotFeedbacks,
  copilotMessages,
  copilotSessions
} from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";
import { retentionCutoff, runCleanup } from "../cleanup";

type DeleteResult = ReadonlyArray<{ id: number; date?: string }>;
const COPILOT_EMPTY: DeleteResult[] = [[], [], [], []];

function makeFakeDb(returnSequence: DeleteResult[]) {
  const calls: DeleteResult[] = [];
  const deleteTables: unknown[] = [];
  let idx = 0;
  const chain = {
    delete: (table: unknown) => {
      deleteTables.push(table);
      return chain;
    },
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
    __calls: calls,
    __deleteTables: deleteTables
  } as unknown as Parameters<typeof runCleanup>[0] & {
    __calls: DeleteResult[];
    __deleteTables: unknown[];
  };
}

describe("cleanup retentionCutoff", () => {
  it("computes the 90-day retention cutoff in Asia/Shanghai", () => {
    const cutoff = retentionCutoff(new Date("2026-05-11T00:00:00Z"));
    expect(cutoff.date).toBe(
      dayjs("2026-05-11T00:00:00Z").tz(APP_TIMEZONE).subtract(90, "day").format("YYYY-MM-DD")
    );
  });
});

describe("cleanup runCleanup commodity extensions (T-CB-15)", () => {
  it("returns counts for v1.0 + v1.1 + daily_pushes tables in CleanupResult", async () => {
    const db = makeFakeDb([
      [{ id: 1, date: "2026-01-01" }],
      [{ id: 11 }, { id: 12 }],
      [{ id: 21 }],
      [{ id: 31 }, { id: 32 }, { id: 33 }],
      [{ id: 41 }],
      [{ id: 51 }, { id: 52 }], // daily_pushes
      ...COPILOT_EMPTY
    ]);
    const result = await runCleanup(db, new Date("2026-05-19T00:00:00Z"));
    expect(result).toEqual({
      deletedItems: 2,
      deletedDailyReports: 1,
      deletedStaleClusters: 1,
      deletedCommodityQuotes: 3,
      deletedCommodityBriefings: 1,
      deletedDailyPushes: 2,
      deletedCopilotFeedbacks: 0,
      deletedCopilotMessages: 0,
      deletedCopilotAuditLog: 0,
      deletedCopilotSessions: 0
    });
  });

  it("handles empty results across all DELETEs", async () => {
    const db = makeFakeDb([[], [], [], [], [], [], ...COPILOT_EMPTY]);
    const result = await runCleanup(db, new Date("2026-05-19T00:00:00Z"));
    expect(result.deletedCommodityQuotes).toBe(0);
    expect(result.deletedCommodityBriefings).toBe(0);
    expect(result.deletedDailyPushes).toBe(0);
    expect(result.deletedCopilotFeedbacks).toBe(0);
    expect(result.deletedCopilotMessages).toBe(0);
    expect(result.deletedCopilotAuditLog).toBe(0);
    expect(result.deletedCopilotSessions).toBe(0);
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

describe("cleanup runCleanup copilot retention (T-CA-10)", () => {
  it("returns the four copilot counts after the commodity deletes", async () => {
    const db = makeFakeDb([
      [],
      [],
      [],
      [],
      [],
      [],
      [{ id: 61 }],
      [{ id: 71 }, { id: 72 }],
      [{ id: 81 }],
      [{ id: 91 }, { id: 92 }, { id: 93 }]
    ]);
    const result = await runCleanup(db, new Date("2026-05-19T00:00:00Z"));
    expect(result.deletedCopilotFeedbacks).toBe(1);
    expect(result.deletedCopilotMessages).toBe(2);
    expect(result.deletedCopilotAuditLog).toBe(1);
    expect(result.deletedCopilotSessions).toBe(3);
  });

  it("deletes messages before sessions, by createdAt not lastActive (design §3.5 fixture)", async () => {
    // Spec fixture: session.last_active is fresh, but a message created_at 100 days
    // ago is still deleted in step 2. Fake db cannot evaluate SQL WHERE, so we
    // assert delete order + source predicates. Cutoffs: feedbacks/messages/sessions
    // = 90 days via retentionCutoff; audit_log = 365 days (same dayjs tz subtract
    // as commodity_quotes). Cannot replay production rows — declared.
    const db = makeFakeDb([
      [],
      [],
      [],
      [],
      [],
      [],
      [{ id: 1 }],
      [{ id: 2 }],
      [{ id: 3 }],
      []
    ]);
    await runCleanup(db, new Date("2026-05-19T00:00:00Z"));

    const tables = db.__deleteTables;
    const messagesIdx = tables.indexOf(copilotMessages);
    const sessionsIdx = tables.indexOf(copilotSessions);
    expect(tables.slice(-4)).toEqual([
      copilotFeedbacks,
      copilotMessages,
      copilotAuditLog,
      copilotSessions
    ]);
    expect(messagesIdx).toBeGreaterThan(-1);
    expect(sessionsIdx).toBeGreaterThan(messagesIdx);

    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../cleanup.ts"),
      "utf8"
    );
    expect(source).toContain("lt(copilotMessages.createdAt, cutoff.timestamp)");
    expect(source).toContain("lt(copilotSessions.lastActive, cutoff.timestamp)");
    expect(source).not.toMatch(/lt\(copilotMessages\.lastActive/);
    expect(source).not.toMatch(/delete\(\s*copilotFeatureFlags/);
    expect(source).not.toMatch(/delete\(\s*copilotItemFulltext/);
    expect(source).toContain('table: "copilot.feedbacks", retentionDays: 90');
    expect(source).toContain('table: "copilot.messages", retentionDays: 90');
    expect(source).toContain('table: "copilot.audit_log", retentionDays: 365');
    expect(source).toContain('table: "copilot.sessions", retentionDays: 90');
  });
});
