import { readFileSync } from "fs";
import { join } from "path";
import type * as Undici from "undici";
import { fetch as undiciFetch } from "undici";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as szse from "../szse";

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
  const actual = await importOriginal<typeof Undici>();
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

describe("szse adapter helpers", () => {
  it("builds request body with stock and explicit date range", () => {
    const body = szse.buildSzseRequestBody({
      type: "announcement",
      adapter: "szse",
      stock: "000001",
      beginDate: "2026-05-01",
      endDate: "2026-05-27",
      bigCategoryId: "010301",
      pageSize: 10,
      pageNum: 2,
    });

    expect(body).toMatchObject({
      stock: ["000001"],
      seDate: ["2026-05-01", "2026-05-27"],
      bigCategoryId: ["010301"],
      channelCode: ["listedNotice_disc"],
      pageSize: 10,
      pageNum: 2,
    });
  });

  it("maps summary to content when body is absent", () => {
    const item = szse.mapSzseRecordToStandardItem({
      id: "abc",
      title: "测试公告",
      summary: "摘要内容",
      publishTime: "2026-05-20 09:30:00",
    });

    expect(item).toMatchObject({
      title: "测试公告",
      url: szse.buildSzseDetailUrl("abc"),
      content: "摘要内容",
    });
    expect(item?.publishedAt).toBeInstanceOf(Date);
  });

  it("drops records with missing required fields", () => {
    expect(szse.mapSzseRecordToStandardItem({ title: "无链接" })).toBeNull();
    expect(szse.parseSzsePublishTime("bad-date")).toBeNull();
  });
});

describe("szseAdapter.fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct adapter name", () => {
    expect(szse.szseAdapter.name).toBe("szse");
  });

  it("maps a successful SZSE response fixture", async () => {
    mockFetch.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        return jsonResponse(JSON.parse(loadFixture("szse-ok.json")));
      }
      return robotsResponse();
    });

    const items = await szse.szseAdapter.fetch({
      sourceName: "深交所披露",
      sourceConfig: {
        type: "announcement",
        adapter: "szse",
        seDate: ["2026-05-01", "2026-05-27"],
        pageSize: 5,
      },
    });

    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.url).toMatch(/^http:\/\/www\.szse\.cn\//);
      expect(item.content.length).toBeGreaterThan(0);
      expect(item.publishedAt).toBeInstanceOf(Date);
    }
  });

  it("returns [] for empty API results", async () => {
    mockFetch.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        return jsonResponse(JSON.parse(loadFixture("szse-empty.json")));
      }
      return robotsResponse();
    });

    const items = await szse.szseAdapter.fetch({ sourceName: "深交所披露" });
    expect(items).toEqual([]);
  });

  it("returns [] when HTTP fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    const items = await szse.szseAdapter.fetch({ sourceName: "深交所披露" });
    expect(items).toEqual([]);
  });

  it("returns [] when API responds with rate limiting", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 429));

    const items = await szse.szseAdapter.fetch({ sourceName: "深交所披露" });
    expect(items).toEqual([]);
  });

  it("skips malformed records while keeping valid ones", async () => {
    mockFetch.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        return jsonResponse(JSON.parse(loadFixture("szse-partial-fields.json")));
      }
      return robotsResponse();
    });

    const items = await szse.szseAdapter.fetch({ sourceName: "深交所披露" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "远东股份：关于项目中标的公告",
      content: "项目中标摘要",
      url: szse.buildSzseDetailUrl("valid-item-id"),
    });
  });
});

describe("mapSzseResponseToStandardItems", () => {
  it("returns [] when data is missing", () => {
    expect(szse.mapSzseResponseToStandardItems({})).toEqual([]);
    expect(szse.mapSzseResponseToStandardItems({ data: [] })).toEqual([]);
  });
});
