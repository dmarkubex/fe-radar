import { readFileSync } from "fs";
import { join } from "path";
import type * as FeRadarCore from "@fe-radar/core";
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

// T-CA-04: partial mock —— 只替换 waitHostGapForUrl 为 spy（默认 no-op），
// 供「POST 前打闸」断言；其余 core 导出（url-guard 等）走真实现。
const mockWaitHostGap = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@fe-radar/core", async (importOriginal) => {
  const actual = await importOriginal<typeof FeRadarCore>();
  return { ...actual, waitHostGapForUrl: mockWaitHostGap };
});

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

  it("treats stocks as an alias for stock filters", () => {
    const body = szse.buildSzseRequestBody({
      type: "announcement",
      adapter: "szse",
      stocks: ["000001", "000002"],
    });

    expect(body.stock).toEqual(["000001", "000002"]);
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

  it("waits the host gap gate before each POST (T-CA-04 IN④)", async () => {
    const order: string[] = [];
    mockWaitHostGap.mockImplementation(async () => {
      order.push("gap");
    });
    mockFetch.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        order.push("post");
        return jsonResponse(JSON.parse(loadFixture("szse-ok.json")));
      }
      return robotsResponse();
    });

    await szse.szseAdapter.fetch({ sourceName: "深交所披露" });

    expect(order).toEqual(["gap", "post"]);
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

  it("throws when HTTP fetch fails", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    await expect(szse.szseAdapter.fetch({ sourceName: "深交所披露" })).rejects.toMatchObject({
      code: "FETCH_TIMEOUT",
    });
  });

  it("returns empty when API responds with rate limiting", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 429));

    const items = await szse.szseAdapter.fetch({ sourceName: "深交所披露" });
    expect(items).toEqual([]);
  });

  it("rejects unapproved endpoint overrides", async () => {
    await expect(szse.szseAdapter.fetch({
      sourceName: "深交所披露",
      sourceConfig: {
        type: "announcement",
        adapter: "szse",
        endpoint: "http://169.254.169.254/latest/meta-data",
      },
    })).rejects.toMatchObject({ code: "FETCH_CONFIG" });
  });

  it("rejects non-default ports (different origin on the same host)", () => {
    for (const bad of [
      "http://www.szse.cn:8080/api/disc/announcement/annList",
      "https://www.szse.cn:8443/api/disc/announcement/annList",
    ]) {
      expect(() =>
        szse.resolveSzseEndpoint({
          type: "announcement",
          adapter: "szse",
          endpoint: bad,
        })
      ).toThrow(/not allowed/);
    }
  });

  it("rejects endpoints with embedded credentials (Node fetch cannot construct them)", () => {
    for (const bad of [
      "http://u:p@www.szse.cn/api/disc/announcement/annList",
      "http://u@www.szse.cn/api/disc/announcement/annList",
      // password-only: username="" password="pass" — must hit password !== "" clause
      "http://:pass@www.szse.cn/api/disc/announcement/annList",
    ]) {
      expect(() =>
        szse.resolveSzseEndpoint({
          type: "announcement",
          adapter: "szse",
          endpoint: bad,
        })
      ).toThrow(/not allowed/);
    }
  });

  it("rejects non-http(s) protocols", () => {
    expect(() =>
      szse.resolveSzseEndpoint({
        type: "announcement",
        adapter: "szse",
        endpoint: "file://www.szse.cn/api/disc/announcement/annList",
      })
    ).toThrow(/not allowed/);
  });

  it("still accepts seed http:// DEFAULT_ENDPOINT and https upgrade on default port", () => {
    // Seed and DEFAULT_ENDPOINT are http:// — must NOT force https (would break live T1).
    expect(
      szse.resolveSzseEndpoint({
        type: "announcement",
        adapter: "szse",
        endpoint: "http://www.szse.cn/api/disc/announcement/annList",
      })
    ).toBe("http://www.szse.cn/api/disc/announcement/annList");
    expect(
      szse.resolveSzseEndpoint({
        type: "announcement",
        adapter: "szse",
        endpoint: "https://www.szse.cn/api/disc/announcement/annList",
      })
    ).toBe("https://www.szse.cn/api/disc/announcement/annList");
  });

  it("still rejects wrong host or path", () => {
    for (const bad of [
      "http://evil.example/api/disc/announcement/annList",
      "http://www.szse.cn/other/path",
    ]) {
      expect(() =>
        szse.resolveSzseEndpoint({
          type: "announcement",
          adapter: "szse",
          endpoint: bad,
        })
      ).toThrow(/not allowed/);
    }
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
