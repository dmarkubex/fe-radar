import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch as undiciFetch } from "undici";
import * as sse from "../sse";

const FIXTURES = join(__dirname, "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

function jsonResponse(body: unknown, status = 200): Awaited<ReturnType<typeof undiciFetch>> {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }) as unknown as Awaited<ReturnType<typeof undiciFetch>>;
}

function robotsResponse(): Awaited<ReturnType<typeof undiciFetch>> {
  return new Response("User-agent: *\nAllow: /", { status: 200 }) as unknown as Awaited<ReturnType<typeof undiciFetch>>;
}

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetch: vi.fn(),
    ProxyAgent: vi.fn(),
  };
});

vi.mock("../../lib/proxy-pool", () => ({
  proxyPool: {
    acquire: vi.fn(() => undefined),
    release: vi.fn(),
  },
}));

vi.mock("../../lib/ua-pool", () => ({
  acquireUserAgent: vi.fn(() => "test-agent"),
}));

vi.mock("../../lib/robots", () => ({
  assertRobotsAllowed: vi.fn().mockResolvedValue(undefined),
}));

const mockFetch = vi.mocked(undiciFetch);

describe("sse adapter helpers", () => {
  it("builds query params with securityCode and explicit date range", () => {
    const params = sse.buildSseQueryParams({
      type: "announcement",
      adapter: "sse",
      securityCode: "600869",
      beginDate: "2026-05-01",
      endDate: "2026-05-27",
      bulletinType: "0101",
      pageSize: 10,
      pageBegin: 0,
    });

    expect(params).toMatchObject({
      securityCode: "600869",
      bulletinType: "0101",
      beginDate: "2026-05-01",
      endDate: "2026-05-27",
      "pageHelp.pageSize": "10",
      "pageHelp.beginPage": "0",
      isPagination: "true",
    });
  });

  it("builds query params with default date range when none provided", () => {
    const params = sse.buildSseQueryParams({
      type: "announcement",
      adapter: "sse",
    });

    expect(params.beginDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.isPagination).toBe("true");
  });

  it("maps title to content when present", () => {
    const item = sse.mapSseRecordToStandardItem({
      bulletinId: "abc",
      title: "远东股份：关于项目中标的公告",
      securityCode: "600869",
      securityAbbrev: "远东股份",
      adjunctUrl: "/disclosure/bulletin/detail/bulletinId/abc/",
      sseDate: "2026-05-20",
    });

    expect(item).toMatchObject({
      title: "远东股份：关于项目中标的公告",
      url: sse.buildSseDetailUrl("/disclosure/bulletin/detail/bulletinId/abc/"),
      content: "远东股份：关于项目中标的公告",
    });
    expect(item?.publishedAt).toBeInstanceOf(Date);
  });

  it("drops records with missing required fields", () => {
    expect(sse.mapSseRecordToStandardItem({ title: "无链接" })).toBeNull();
    expect(sse.parseSseDate("bad-date")).toBeNull();
    expect(sse.parseSseDate("")).toBeNull();
  });

  it("builds detail URL from adjunctUrl", () => {
    expect(sse.buildSseDetailUrl("/disclosure/abc")).toBe("http://www.sse.com.cn/disclosure/abc");
    expect(sse.buildSseDetailUrl("disclosure/abc")).toBe("http://www.sse.com.cn/disclosure/abc");
  });

  it("resolves URL from bulletinId when adjunctUrl is missing", () => {
    const item = sse.mapSseRecordToStandardItem({
      bulletinId: "fallback-id",
      title: "测试公告",
      sseDate: "2026-05-20",
    });

    expect(item?.url).toBe("http://www.sse.com.cn/disclosure/bulletin/detail/bulletinId/fallback-id/");
  });
});

describe("sseAdapter.fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct adapter name", () => {
    expect(sse.sseAdapter.name).toBe("sse");
  });

  it("maps a successful SSE response fixture", async () => {
    mockFetch.mockImplementation(async (_url, init) => {
      if (init?.method === "GET" || !init?.method) {
        return jsonResponse(JSON.parse(loadFixture("sse-ok.json")));
      }
      return robotsResponse();
    });

    const items = await sse.sseAdapter.fetch({
      sourceName: "上交所公告",
      sourceConfig: {
        type: "announcement",
        adapter: "sse",
        securityCode: "600869",
        beginDate: "2026-05-01",
        endDate: "2026-05-27",
      },
    });

    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.url).toMatch(/^http:\/\/www\.sse\.com\.cn\//);
      expect(item.content.length).toBeGreaterThan(0);
      expect(item.publishedAt).toBeInstanceOf(Date);
    }
  });

  it("returns [] for empty API results", async () => {
    mockFetch.mockImplementation(async (_url, init) => {
      if (init?.method === "GET" || !init?.method) {
        return jsonResponse(JSON.parse(loadFixture("sse-empty.json")));
      }
      return robotsResponse();
    });

    const items = await sse.sseAdapter.fetch({ sourceName: "上交所公告" });
    expect(items).toEqual([]);
  });

  it("returns [] when HTTP fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    const items = await sse.sseAdapter.fetch({ sourceName: "上交所公告" });
    expect(items).toEqual([]);
  });

  it("returns [] when API responds with rate limiting", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 429));

    const items = await sse.sseAdapter.fetch({ sourceName: "上交所公告" });
    expect(items).toEqual([]);
  });

  it("skips malformed records while keeping valid ones", async () => {
    mockFetch.mockImplementation(async (_url, init) => {
      if (init?.method === "GET" || !init?.method) {
        return jsonResponse(JSON.parse(loadFixture("sse-partial-fields.json")));
      }
      return robotsResponse();
    });

    const items = await sse.sseAdapter.fetch({ sourceName: "上交所公告" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "远东股份：关于项目中标的公告",
      content: "远东股份：关于项目中标的公告",
      url: sse.buildSseDetailUrl("/disclosure/bulletin/detail/bulletinId/valid-item-id/"),
    });
  });
});

describe("mapSseResponseToStandardItems", () => {
  it("returns [] when pageHelp is missing", () => {
    expect(sse.mapSseResponseToStandardItems({})).toEqual([]);
  });

  it("returns [] when data is empty", () => {
    expect(sse.mapSseResponseToStandardItems({ pageHelp: { data: [] } })).toEqual([]);
  });

  it("returns [] when data is missing", () => {
    expect(sse.mapSseResponseToStandardItems({ pageHelp: {} })).toEqual([]);
  });
});
