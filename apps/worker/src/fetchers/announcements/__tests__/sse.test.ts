import { readFileSync } from "fs";
import { join } from "path";
import type * as Undici from "undici";
import { fetch as undiciFetch } from "undici";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as sse from "../sse";

const FIXTURES = join(__dirname, "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

function jsonpResponse(body: unknown, status = 200): Awaited<ReturnType<typeof undiciFetch>> {
  return new Response(`jsonpCallback(${JSON.stringify(body)})`, {
    status,
    headers: { "content-type": "application/javascript" },
  }) as unknown as Awaited<ReturnType<typeof undiciFetch>>;
}

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof Undici>();
  return {
    ...actual,
    fetch: vi.fn(),
    ProxyAgent: vi.fn(),
  };
});

vi.mock("../../../lib/proxy-pool", () => ({
  proxyPool: {
    acquire: vi.fn(() => undefined),
    release: vi.fn(),
  },
}));

vi.mock("../../../lib/ua-pool", () => ({
  acquireUserAgent: vi.fn(() => "test-agent"),
}));

vi.mock("../../../lib/robots", () => ({
  assertRobotsAllowed: vi.fn().mockResolvedValue(undefined),
}));

const mockFetch = vi.mocked(undiciFetch);

describe("sse adapter helpers", () => {
  it("builds query URL with stock and explicit date range", () => {
    const url = sse.buildSseQueryUrl({
      type: "announcement",
      adapter: "sse",
      stock: "600869",
      beginDate: "2026-05-01",
      endDate: "2026-05-27",
      pageSize: 10,
      pageNum: 1,
    });

    expect(url).toContain("queryCompanyBulletin.do");
    expect(url).toContain("securityCode=600869");
    expect(url).toContain("beginDate=2026-05-01");
    expect(url).toContain("endDate=2026-05-27");
    expect(url).toContain("pageHelp.pageSize=10");
    expect(url).toContain("pageHelp.beginPage=1");
  });

  it("parses JSONP wrapper into API payload", () => {
    const parsed = sse.parseSseJsonp(`jsonpCallback(${loadFixture("sse-ok.json")})`);
    expect(parsed?.success).toBe("true");
    expect(parsed?.pageHelp?.data?.length).toBe(5);
  });

  it("parses SSE publish time in Shanghai zone", () => {
    const date = sse.parseSsePublishTime("2026-05-20 17:30:00");
    expect(date).toBeInstanceOf(Date);
    expect(date?.toISOString()).toBe("2026-05-20T09:30:00.000Z");
  });

  it("uses title as content when body is absent", () => {
    expect(
      sse.resolveSseItemContent({
        title: "测试公告",
        securityCode: "600869",
        securityAbbrev: "远东股份",
      })
    ).toBe("测试公告");
  });

  it("maps uppercase API fields to StandardItem", () => {
    const item = sse.mapSseRecordToStandardItem({
      title: "远东控股：关于签订重大合同的公告",
      url: "/disclosure/listedinfo/announcement/c/new/2026-05-20/5885159490.pdf",
      sseDate: "2026-05-20 17:30:00",
      securityCode: "600869",
      securityAbbrev: "远东股份",
    });

    expect(item).toMatchObject({
      title: "远东控股：关于签订重大合同的公告",
      url: sse.buildSseBulletinUrl("/disclosure/listedinfo/announcement/c/new/2026-05-20/5885159490.pdf"),
      content: "远东控股：关于签订重大合同的公告",
    });
    expect(item?.publishedAt).toBeInstanceOf(Date);
  });

  it("drops records with missing required fields", () => {
    expect(sse.mapSseRecordToStandardItem({ title: "无链接" })).toBeNull();
    expect(sse.parseSsePublishTime("bad-date")).toBeNull();
  });
});

describe("sseAdapter.fetch", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("has correct adapter name", () => {
    expect(sse.sseAdapter.name).toBe("sse");
  });

  it("maps a successful SSE JSONP fixture", async () => {
    mockFetch.mockResolvedValue(jsonpResponse(JSON.parse(loadFixture("sse-ok.json"))));

    const items = await sse.sseAdapter.fetch({
      sourceName: "上交所公告",
      sourceConfig: {
        type: "announcement",
        adapter: "sse",
        beginDate: "2026-05-01",
        endDate: "2026-05-27",
        pageSize: 5,
      },
    });

    expect(mockFetch).toHaveBeenCalled();
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.url).toMatch(/^https:\/\/www\.sse\.com\.cn\//);
      expect(item.content.length).toBeGreaterThan(0);
      expect(item.publishedAt).toBeInstanceOf(Date);
    }
  });

  it("returns [] for empty API results", async () => {
    mockFetch.mockResolvedValueOnce(jsonpResponse(JSON.parse(loadFixture("sse-empty.json"))));

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
      .mockResolvedValueOnce(jsonpResponse({}, 429))
      .mockResolvedValueOnce(jsonpResponse({}, 429));

    const items = await sse.sseAdapter.fetch({ sourceName: "上交所公告" });
    expect(items).toEqual([]);
  });

  it("skips malformed records while keeping valid ones", async () => {
    mockFetch.mockResolvedValueOnce(jsonpResponse(JSON.parse(loadFixture("sse-partial-fields.json"))));

    const items = await sse.sseAdapter.fetch({ sourceName: "上交所公告" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "远东控股：关于项目中标的公告",
      content: "远东控股：关于项目中标的公告",
      url: sse.buildSseBulletinUrl("/disclosure/listedinfo/announcement/c/new/2026-05-20/valid.pdf"),
    });
  });

  it("returns [] when JSONP body cannot be parsed", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("not-jsonp", { status: 200 }) as unknown as Awaited<ReturnType<typeof undiciFetch>>
    );

    const items = await sse.sseAdapter.fetch({ sourceName: "上交所公告" });
    expect(items).toEqual([]);
  });
});

describe("mapSseResponseToStandardItems", () => {
  it("returns [] when data is missing or API reports failure", () => {
    expect(sse.mapSseResponseToStandardItems({})).toEqual([]);
    expect(sse.mapSseResponseToStandardItems({ pageHelp: { data: [] } })).toEqual([]);
    expect(sse.mapSseResponseToStandardItems({ success: "false", error: "系统繁忙..." })).toEqual([]);
  });

  it("maps normalized records from pageHelp.data", () => {
    const items = sse.mapSseResponseToStandardItems(JSON.parse(loadFixture("sse-ok.json")));
    expect(items).toHaveLength(5);
    expect(items[0]?.title).toContain("远东控股");
  });
});
