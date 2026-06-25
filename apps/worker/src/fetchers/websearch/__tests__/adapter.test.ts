import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchContext, StandardItem } from "../../types";
import { websearchAdapter, fetchWebsearch } from "../adapter";
import type { WebsearchResult } from "../types";

vi.mock("../client", () => ({
  websearchSearch: vi.fn(),
}));

import { websearchSearch } from "../client";

const mockedWebsearchSearch = vi.mocked(websearchSearch);

function buildCtx(query: string, extra?: Record<string, unknown>): FetchContext {
  return {
    sourceName: "doubao-websearch",
    sourceConfig: { type: "websearch", query, ...extra },
  };
}

describe("websearch adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has name 'doubao'", () => {
    expect(websearchAdapter.name).toBe("doubao");
  });

  it("maps WebsearchResult[] to StandardItem[]", async () => {
    const results: WebsearchResult[] = [
      {
        Title: "电解铜价格创新高",
        Url: "https://example.com/copper",
        Snippet: "沪铜主力合约收盘上涨",
        PublishTime: "2026-06-24T08:00:00Z",
      },
      {
        Title: "碳酸锂市场分析",
        Url: "https://example.com/lithium",
        Snippet: "电池级碳酸锂供需平衡",
        PublishTime: "2026-06-23T10:30:00Z",
      },
    ];
    mockedWebsearchSearch.mockResolvedValueOnce(results);

    const out = await fetchWebsearch(buildCtx("铜价格"));

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual<StandardItem>({
      url: "https://example.com/copper",
      title: "电解铜价格创新高",
      content: "沪铜主力合约收盘上涨",
      publishedAt: new Date("2026-06-24T08:00:00Z"),
    });
  });

  it("uses Summary as content when Snippet is empty", async () => {
    mockedWebsearchSearch.mockResolvedValueOnce([
      { Title: "标题", Url: "https://example.com/a", Summary: "摘要内容" },
    ]);

    const out = await fetchWebsearch(buildCtx("铜"));

    expect(out[0]!.content).toBe("摘要内容");
  });

  it("falls back to now() when PublishTime is missing or invalid", async () => {
    const before = Date.now();
    mockedWebsearchSearch.mockResolvedValueOnce([
      { Title: "无时间", Url: "https://example.com/no-time" },
      { Title: "坏时间", Url: "https://example.com/bad-time", PublishTime: "not-a-date" },
    ]);

    const out = await fetchWebsearch(buildCtx("铜"));
    const after = Date.now();

    expect(out).toHaveLength(2);
    for (const item of out) {
      expect(item.publishedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(item.publishedAt.getTime()).toBeLessThanOrEqual(after);
    }
  });

  it("filters out results missing Url or Title", async () => {
    mockedWebsearchSearch.mockResolvedValueOnce([
      { Title: "有标题无URL" },
      { Url: "https://example.com/no-title" },
      { Title: "完整", Url: "https://example.com/ok" },
    ]);

    const out = await fetchWebsearch(buildCtx("铜"));
    expect(out).toHaveLength(1);
    expect(out[0]!.url).toBe("https://example.com/ok");
  });

  it("returns [] when query is missing", async () => {
    const out = await fetchWebsearch({
      sourceName: "doubao-websearch",
      sourceConfig: { type: "websearch" },
    });
    expect(out).toEqual([]);
    expect(mockedWebsearchSearch).not.toHaveBeenCalled();
  });

  it("returns [] when query is whitespace-only", async () => {
    const out = await fetchWebsearch(buildCtx("   "));
    expect(out).toEqual([]);
    expect(mockedWebsearchSearch).not.toHaveBeenCalled();
  });

  it("returns [] when scrubText level is block (PII threshold)", async () => {
    // 多个手机号 + 身份证 → piiCount >= 3 → level='block'
    const piiQuery = "联系人 13812345678 13912345678 13712345678";

    const out = await fetchWebsearch(buildCtx(piiQuery));
    expect(out).toEqual([]);
    expect(mockedWebsearchSearch).not.toHaveBeenCalled();
  });

  it("returns [] on client error (never throws)", async () => {
    mockedWebsearchSearch.mockRejectedValueOnce(new Error("network down"));

    const out = await fetchWebsearch(buildCtx("铜价格"));
    expect(out).toEqual([]);
  });

  it("sends cleaned query (scrubbed) to websearchSearch", async () => {
    mockedWebsearchSearch.mockResolvedValueOnce([]);

    // 含单个邮箱 → level='redacted'，cleaned 中邮箱被替换但仍可搜索
    await fetchWebsearch(buildCtx("联系 a@b.com 查铜价"));

    expect(mockedWebsearchSearch).toHaveBeenCalledOnce();
    const [queryArg] = mockedWebsearchSearch.mock.calls[0] as [string];
    expect(queryArg).not.toContain("a@b.com");
    expect(queryArg).toContain("铜价");
  });

  it("passes timeRange / count / authInfoLevel from config to client", async () => {
    mockedWebsearchSearch.mockResolvedValueOnce([]);

    await fetchWebsearch(
      buildCtx("铜", { timeRange: "OneDay", count: 8, authInfoLevel: 3 })
    );

    const [, options] = mockedWebsearchSearch.mock.calls[0] as [
      string,
      { timeRange?: string; count?: number; authInfoLevel?: number }
    ];
    expect(options.timeRange).toBe("OneDay");
    expect(options.count).toBe(8);
    expect(options.authInfoLevel).toBe(3);
  });
});
