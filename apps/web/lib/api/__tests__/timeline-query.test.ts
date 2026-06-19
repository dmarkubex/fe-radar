import { describe, expect, it } from "vitest";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

import { mockFetchTimeline, mockTimelineItems } from "@/lib/mock-data";
import { decodeCursor } from "../cursor";
import {
  encodeTimelineCursor,
  resolveTimelinePaginationPlan,
  type TimelineItemDto
} from "../timeline-query";

function byPublishedDesc(
  a: { id: number; publishedAt: string },
  b: { id: number; publishedAt: string }
): number {
  return (
    dayjs(b.publishedAt).valueOf() - dayjs(a.publishedAt).valueOf() ||
    b.id - a.id
  );
}

function collectTimelinePages(options: { limit: number; search?: string }) {
  const items: TimelineItemDto[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard += 1) {
    const page = mockFetchTimeline({ ...options, cursor });
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

function timeBucket(iso: string): string {
  const hour = dayjs(iso).tz(APP_TIMEZONE).hour();
  if (hour < 6) return "dawn";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

describe("timeline query pagination plan", () => {
  it("uses publishedAt for the default order and keyset cursor", () => {
    const plan = resolveTimelinePaginationPlan({});
    const publishedAt = dayjs("2026-06-18T08:00:00.000Z").toDate();
    const scoredAt = dayjs("2026-06-18T09:00:00.000Z").toDate();

    const cursor = encodeTimelineCursor(
      { id: 11, publishedAt, scoredAt },
      plan.keysetAxis
    );

    expect(plan).toEqual({ orderBy: "publishedAt", keysetAxis: "publishedAt" });
    expect(decodeCursor(cursor ?? undefined)).toEqual({
      at: publishedAt.toISOString(),
      id: 11
    });
  });

  it("keeps curated order on qualityScore and keyset on scoredAt", () => {
    const plan = resolveTimelinePaginationPlan({ curated: true });
    const publishedAt = dayjs("2026-06-18T08:00:00.000Z").toDate();
    const scoredAt = dayjs("2026-06-18T09:00:00.000Z").toDate();

    const cursor = encodeTimelineCursor(
      { id: 12, publishedAt, scoredAt },
      plan.keysetAxis
    );

    expect(plan).toEqual({ orderBy: "qualityScore", keysetAxis: "scoredAt" });
    expect(decodeCursor(cursor ?? undefined)).toEqual({
      at: scoredAt.toISOString(),
      id: 12
    });
  });
});

describe("mock timeline keyset behavior", () => {
  it("maps curated English category slugs to Chinese item categories in mock mode", () => {
    const rows = mockFetchTimeline({
      filters: { curated: true, category: "project" },
      limit: 20
    }).items;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((item) => item.category === "项目与招投标")).toBe(true);
  });

  it("hides crawl/risk-search external URLs behind AI acquisition labels", () => {
    const item = mockTimelineItems.find((entry) => entry.id === 26);

    expect(item).toMatchObject({
      url: "/items/26",
      displayUrl: null,
      sourceFetcherType: "crawl",
      acquisitionLabel: "AI检索摘要"
    });
  });

  it("paginates by publishedAt/id without duplicates or gaps across a same-publishedAt boundary", () => {
    const first = mockFetchTimeline({ limit: 1 });

    expect(first.items.map((item) => item.id)).toEqual([30]);
    expect(first.nextCursor).toBeTruthy();

    const second = mockFetchTimeline({
      limit: 1,
      cursor: first.nextCursor ?? undefined
    });
    expect(second.items.map((item) => item.id)).toEqual([29]);

    const expected = [...mockTimelineItems]
      .sort(byPublishedDesc)
      .map((item) => item.id);
    const actual = collectTimelinePages({ limit: 2 }).map((item) => item.id);

    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(actual.length);
  });

  it("orders search results by publishedAt/id and keeps cursor pagination gap-free", () => {
    const expected = mockTimelineItems
      .filter((item) =>
        `${item.title} ${item.summaryZh ?? ""} ${item.sourceName}`
          .toLowerCase()
          .includes("电缆")
      )
      .sort(byPublishedDesc)
      .map((item) => item.id);

    const actual = collectTimelinePages({ limit: 3, search: "电缆" }).map(
      (item) => item.id
    );

    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(actual.length);
  });

  it("contains at least three days with at least two populated time buckets per day", () => {
    const rows = mockFetchTimeline({ limit: 50 }).items;
    const bucketsByDay = new Map<string, Set<string>>();

    for (const item of rows) {
      const dayKey = dayjs(item.publishedAt)
        .tz(APP_TIMEZONE)
        .format("YYYY-MM-DD");
      const buckets = bucketsByDay.get(dayKey) ?? new Set<string>();
      buckets.add(timeBucket(item.publishedAt));
      bucketsByDay.set(dayKey, buckets);
    }

    expect(bucketsByDay.size).toBeGreaterThanOrEqual(3);
    for (const buckets of bucketsByDay.values()) {
      expect(buckets.size).toBeGreaterThanOrEqual(2);
    }
  });
});
