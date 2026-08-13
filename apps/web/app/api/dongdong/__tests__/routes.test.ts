import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  dailyTable: { kind: "daily" },
  briefingTable: { kind: "briefing" },
  dailyRows: [] as unknown[],
  briefingRows: [] as unknown[],
  fetchTimeline: vi.fn(),
  authenticate: vi.fn()
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  sql: vi.fn()
}));
vi.mock("@/lib/auth/dongdong-service", () => ({
  authenticateDongdongRequest: mocks.authenticate
}));
vi.mock("@/lib/api/timeline-query", () => ({
  fetchTimeline: mocks.fetchTimeline
}));
vi.mock("@fe-radar/db", () => ({
  dailyReports: Object.assign(mocks.dailyTable, {
    date: "date",
    sections: "sections"
  }),
  commodityBriefings: Object.assign(mocks.briefingTable, {
    id: "id",
    briefingDate: "briefingDate",
    payloadJson: "payloadJson",
    genStatus: "genStatus"
  }),
  getDb: () => ({
    select: () => ({
      from: (table: { kind: string }) => ({
        where: () => ({
          orderBy: () => ({
            limit: async (limit: number) =>
              (table.kind === "daily"
                ? mocks.dailyRows
                : mocks.briefingRows
              ).slice(0, limit)
          })
        })
      })
    })
  })
}));

import { GET as getBriefing } from "../briefing/route";
import { GET as search } from "../search/route";

const request = (url: string): NextRequest =>
  ({ url, nextUrl: new URL(url) }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dailyRows = [];
  mocks.briefingRows = [];
  mocks.authenticate.mockResolvedValue({ user: { id: 1 } });
  mocks.fetchTimeline.mockResolvedValue({
    items: [{ id: 9 }],
    nextCursor: null
  });
});

describe("Dongdong FE-Radar integration routes", () => {
  it("searches news through the timeline query", async () => {
    const response = await search(
      request("http://localhost/api/dongdong/search?scope=news&q=铜价")
    );
    expect(response.status).toBe(200);
    expect(mocks.fetchTimeline).toHaveBeenCalledOnce();
  });

  it("returns matching industry daily reports", async () => {
    mocks.dailyRows = [
      { date: "2026-08-12", sections: { market: "铜价上涨" } }
    ];
    const response = await search(
      request("http://localhost/api/dongdong/search?scope=daily&q=铜价")
    );
    const body = await response.json();
    expect(body.items[0]).toMatchObject({ type: "daily", id: "2026-08-12" });
  });

  it("returns matching copper-lithium reports with deep links", async () => {
    mocks.briefingRows = [
      { id: 42, date: "2026-08-12", payload: { macro_summary: "铜锂行情" } }
    ];
    const response = await search(
      request("http://localhost/api/dongdong/search?scope=briefing&q=行情")
    );
    const body = await response.json();
    expect(body.items[0]).toMatchObject({
      type: "briefing",
      path: "/briefing/42"
    });
  });

  it("rejects news search without a keyword", async () => {
    const response = await search(
      request("http://localhost/api/dongdong/search?scope=news")
    );
    expect(response.status).toBe(400);
    expect(mocks.fetchTimeline).not.toHaveBeenCalled();
  });

  it("returns the latest copper-lithium report", async () => {
    mocks.briefingRows = [
      { id: 7, date: "2026-08-12", payload: { risk_notes: [] } }
    ];
    const response = await getBriefing(
      request("http://localhost/api/dongdong/briefing")
    );
    const body = await response.json();
    expect(body.briefing).toMatchObject({ id: 7, path: "/briefing/7" });
  });
});
