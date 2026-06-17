import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch as undiciFetch } from "undici";
import * as cninfo from "../cninfo";

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
  const actual = (await importOriginal()) as Record<string, unknown>;
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

describe("cninfo adapter helpers", () => {
  it("builds form params with stock and explicit date range", () => {
    const params = cninfo.buildCninfoFormParams({
      type: "announcement",
      adapter: "cninfo",
      stock: "600869",
      seDate: "2026-05-01~2026-05-27",
      category: "category_ndbg_szsh",
      pageSize: 10,
      pageNum: 2,
    });

    expect(params).toMatchObject({
      stock: "600869",
      seDate: "2026-05-01~2026-05-27",
      category: "category_ndbg_szsh",
      pageSize: "10",
      pageNum: "2",
    });
  });

  it("falls back to default 7-day date range", () => {
    const params = cninfo.buildCninfoFormParams({
      type: "announcement",
      adapter: "cninfo",
    });

    expect(params.seDate).toContain("~");
    const parts = params.seDate!.split("~");
    expect(parts).toHaveLength(2);
    expect(parts[0]!.length).toBe(10);
    expect(parts[1]!.length).toBe(10);
  });

  it("parses millisecond timestamps correctly", () => {
    const date = cninfo.parseCninfoTimestamp(1748304000000);
    expect(date).toBeInstanceOf(Date);
    expect(date!.getFullYear()).toBeGreaterThanOrEqual(2025);
  });

  it("parses second timestamps by multiplying by 1000", () => {
    const date = cninfo.parseCninfoTimestamp(1748304000);
    expect(date).toBeInstanceOf(Date);
  });

  it("returns null for invalid timestamps", () => {
    expect(cninfo.parseCninfoTimestamp(undefined)).toBeNull();
    expect(cninfo.parseCninfoTimestamp(-1)).toBeNull();
    expect(cninfo.parseCninfoTimestamp(0)).toBeNull();
    expect(cninfo.parseCninfoTimestamp(NaN)).toBeNull();
    expect(cninfo.parseCninfoTimestamp(Infinity)).toBeNull();
  });

  it("builds detail URL from adjunctUrl", () => {
    const url = cninfo.buildCninfoDetailUrl(undefined, "/finalpage/2026-05-27/test.PDF");
    expect(url).toBe("http://static.cninfo.com.cn/finalpage/2026-05-27/test.PDF");
  });

  it("builds detail URL from announcementId when adjunctUrl is missing", () => {
    const url = cninfo.buildCninfoDetailUrl("12345", undefined);
    expect(url).toContain("announcementId=12345");
    expect(url).toContain("cninfo.com.cn");
  });

  it("returns null when both URL sources are missing", () => {
    expect(cninfo.buildCninfoDetailUrl(undefined, undefined)).toBeNull();
    expect(cninfo.buildCninfoDetailUrl("", "")).toBeNull();
  });

  it("uses full adjunctUrl as-is when it starts with http", () => {
    const url = cninfo.buildCninfoDetailUrl(undefined, "http://example.com/file.pdf");
    expect(url).toBe("http://example.com/file.pdf");
  });

  it("maps title to content (summary→content pattern, no body)", () => {
    const item = cninfo.mapCninfoRecordToStandardItem({
      secCode: "600869",
      secName: "远东股份",
      announcementId: "abc",
      announcementTitle: "远东股份：关于项目中标的公告",
      adjunctUrl: "/test.pdf",
      announcementTime: 1748304000000,
    });

    expect(item).toMatchObject({
      title: "远东股份：关于项目中标的公告",
      content: "远东股份：关于项目中标的公告",
    });
    expect(item?.publishedAt).toBeInstanceOf(Date);
  });

  it("drops records with missing required fields", () => {
    expect(cninfo.mapCninfoRecordToStandardItem({ announcementTitle: "无链接" })).toBeNull();
    expect(cninfo.mapCninfoRecordToStandardItem({ adjunctUrl: "/test.pdf", announcementTime: 1748304000000 })).toBeNull();
  });
});

describe("cninfoAdapter.fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct adapter name", () => {
    expect(cninfo.cninfoAdapter.name).toBe("cninfo");
  });

  it("maps a successful CNINFO response fixture", async () => {
    mockFetch.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        return jsonResponse(JSON.parse(loadFixture("cninfo-ok.json")));
      }
      return robotsResponse();
    });

    const items = await cninfo.cninfoAdapter.fetch({
      sourceName: "巨潮资讯",
      sourceConfig: {
        type: "announcement",
        adapter: "cninfo",
        stock: "600869",
        seDate: "2026-05-01~2026-05-27",
        pageSize: 5,
      },
    });

    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.url).toMatch(/^http/);
      expect(item.content.length).toBeGreaterThan(0);
      expect(item.publishedAt).toBeInstanceOf(Date);
    }
  });

  it("returns [] for empty API results", async () => {
    mockFetch.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        return jsonResponse(JSON.parse(loadFixture("cninfo-empty.json")));
      }
      return robotsResponse();
    });

    const items = await cninfo.cninfoAdapter.fetch({ sourceName: "巨潮资讯" });
    expect(items).toEqual([]);
  });

  it("throws when HTTP fetch fails", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    await expect(cninfo.cninfoAdapter.fetch({ sourceName: "巨潮资讯" })).rejects.toMatchObject({
      code: "FETCH_TIMEOUT",
    });
  });

  it("throws when API responds with rate limiting", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 429));

    await expect(cninfo.cninfoAdapter.fetch({ sourceName: "巨潮资讯" })).rejects.toMatchObject({
      code: "FETCH_429",
    });
  });

  it("rejects unapproved endpoint overrides", async () => {
    await expect(cninfo.cninfoAdapter.fetch({
      sourceName: "巨潮资讯",
      sourceConfig: {
        type: "announcement",
        adapter: "cninfo",
        endpoint: "http://169.254.169.254/latest/meta-data",
      },
    })).rejects.toMatchObject({ code: "FETCH_CONFIG" });
  });

  it("skips malformed records while keeping valid ones", async () => {
    mockFetch.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        return jsonResponse(JSON.parse(loadFixture("cninfo-partial-fields.json")));
      }
      return robotsResponse();
    });

    const items = await cninfo.cninfoAdapter.fetch({ sourceName: "巨潮资讯" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "远东股份：关于项目中标的公告",
      content: "远东股份：关于项目中标的公告",
    });
    expect(items[0]?.url).toContain("static.cninfo.com.cn");
  });
});

describe("mapCninfoResponseToStandardItems", () => {
  it("returns [] when announcements is missing", () => {
    expect(cninfo.mapCninfoResponseToStandardItems({})).toEqual([]);
    expect(cninfo.mapCninfoResponseToStandardItems({ announcements: [] })).toEqual([]);
  });
});
