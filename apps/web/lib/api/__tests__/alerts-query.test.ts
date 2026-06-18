import { describe, expect, it } from "vitest";
import { dayjs } from "@fe-radar/shared";

import { mockFetchAlerts, mockTimelineItems } from "@/lib/mock-data";
import { decodeCursor } from "../cursor";
import { encodeAlertCursor } from "../alerts-query";
import type { TimelineItemDto } from "../timeline-query";

function byScoredAtDesc(a: TimelineItemDto, b: TimelineItemDto): number {
  return dayjs(b.scoredAt ?? 0).valueOf() - dayjs(a.scoredAt ?? 0).valueOf() || b.id - a.id;
}

function collectAlertPages(limit: number) {
  const items: TimelineItemDto[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard += 1) {
    const page = mockFetchAlerts({ limit, cursor });
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

    expect(decodeCursor(cursor ?? undefined)).toEqual({ at: scoredAt.toISOString(), id: 42 });
  });

  it("keeps alerts pagination on scoredAt/id without duplicates or gaps", () => {
    const first = mockFetchAlerts({ limit: 1 });

    expect(first.items.map((item) => item.id)).toEqual([30]);
    expect(first.nextCursor).toBeTruthy();

    const second = mockFetchAlerts({ limit: 1, cursor: first.nextCursor ?? undefined });
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
