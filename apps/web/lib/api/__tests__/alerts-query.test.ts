import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dayjs } from "@fe-radar/shared";

import {
  mockFetchAlertCount,
  mockFetchAlerts,
  mockTimelineItems
} from "@/lib/mock-data";
import { alertQuerySchema } from "../alerts-schema";
import { decodeCursor } from "../cursor";
import { encodeAlertCursor } from "../alerts-query";
import type { TimelineItemDto } from "../timeline-query";

const alertsQuerySource = readFileSync(
  resolve(__dirname, "../alerts-query.ts"),
  "utf8"
);

const fetchAlertCountBody = alertsQuerySource.slice(
  alertsQuerySource.indexOf("export async function fetchAlertCount")
);

function byScoredAtDesc(a: TimelineItemDto, b: TimelineItemDto): number {
  return (
    dayjs(b.scoredAt ?? 0).valueOf() - dayjs(a.scoredAt ?? 0).valueOf() ||
    b.id - a.id
  );
}

function collectAlertPages(limit: number) {
  const items: TimelineItemDto[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard += 1) {
    const page = mockFetchAlerts({ limit, cursor, range: "24h" });
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

describe("alerts query pagination", () => {
  it("encodes alert cursors with scoredAt as at", () => {
    const scoredAt = dayjs("2026-06-18T09:00:00.000Z").toDate();
    const cursor = encodeAlertCursor({ id: 42, scoredAt });

    expect(decodeCursor(cursor ?? undefined)).toEqual({
      at: scoredAt.toISOString(),
      id: 42
    });
  });

  it("keeps alerts pagination on scoredAt/id without duplicates or gaps", () => {
    const first = mockFetchAlerts({ limit: 1, range: "24h" });

    expect(first.items.map((item) => item.id)).toEqual([30]);
    expect(first.nextCursor).toBeTruthy();

    const second = mockFetchAlerts({
      limit: 1,
      cursor: first.nextCursor ?? undefined,
      range: "24h"
    });
    expect(second.items.map((item) => item.id)).toEqual([29]);

    const expected = mockTimelineItems
      .filter((item) => item.alertType)
      .sort(byScoredAtDesc)
      .map((item) => item.id);
    const actual = collectAlertPages(2).map((item) => item.id);

    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(actual.length);
  });
});

describe("alertQuerySchema range field", () => {
  it("defaults range to 24h", () => {
    const result = alertQuerySchema.parse({ limit: 10 });
    expect(result.range).toBe("24h");
  });

  it("accepts valid range enum values", () => {
    expect(alertQuerySchema.parse({ range: "7d" }).range).toBe("7d");
    expect(alertQuerySchema.parse({ range: "all" }).range).toBe("all");
    expect(alertQuerySchema.parse({ range: "24h" }).range).toBe("24h");
  });

  it("rejects unknown range values", () => {
    expect(() => alertQuerySchema.parse({ range: "1h" })).toThrow();
    expect(() => alertQuerySchema.parse({ range: "30d" })).toThrow();
  });
});

describe("alerts list-count range window consistency (mock)", () => {
  it("range=all returns all alert items without time filter", () => {
    const result = mockFetchAlerts({ limit: 100, range: "all" });
    const alertItems = mockTimelineItems.filter((i) => i.alertType !== null);
    expect(result.items.length).toBe(alertItems.length);
  });

  it("list and count return consistent totals for same range", () => {
    const list = mockFetchAlerts({ limit: 100, range: "24h" });
    const count = mockFetchAlertCount();
    const countTotal =
      count.own + count.safety + count.policy + count.legal + count.risk;
    expect(list.items.length).toBeLessThanOrEqual(countTotal);
    expect(list.items.length).toBe(countTotal);
  });
});

describe("T-PERF-08 fetchAlertCount GROUP BY source", () => {
  it("aggregates with groupBy(itemAnalysis.alertType)", () => {
    expect(fetchAlertCountBody).toContain("groupBy(itemAnalysis.alertType)");
  });

  it("counts in SQL as count(*)::int", () => {
    expect(fetchAlertCountBody).toContain("count(*)::int");
  });

  it("does not increment a Node-side map", () => {
    expect(fetchAlertCountBody).not.toContain("count[row.alertType] += 1");
  });
});

// T-RR-02 gate assertions live in alerts-query-gate.test.ts (separate file so
// the drizzle-orm mock needed to introspect baseAlertConditions does not
// interfere with the existing mock-mode tests here).
