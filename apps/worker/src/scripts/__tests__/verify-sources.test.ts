import type { FetcherType, SourceRecord } from "@fe-radar/db";
import { describe, expect, it, vi } from "vitest";

import {
  filterSourcesById,
  parseSourceIdArg,
  printJsonlResults,
  printResults,
  toJsonlResult,
  toJsonlSummary,
  verifySourcesWithWorker,
  type DeepVerifyResult
} from "../verify-sources";

function makeSource(
  overrides: Partial<SourceRecord> & {
    fetcherType?: FetcherType;
  } = {}
): SourceRecord {
  return {
    id: 1,
    name: "国家能源局",
    url: "https://www.nea.gov.cn/xwzx/nyyw.htm",
    fetcherType: "announcement",
    config: {
      type: "announcement",
      adapter: "nea-news",
      useRealUa: true
    },
    tier: "T1",
    category: "政策与标准",
    enabled: true,
    lastOkAt: null,
    failCount: 0,
    lastError: null,
    lastErrorAt: null,
    adminTouchedAt: null,
    adminSnapshot: null,
    urlLocked: false,
    createdAt: new Date(),
    ...overrides
  };
}

const item = {
  url: "https://example.com/1",
  title: "真实条目",
  content: "正文",
  publishedAt: new Date()
};

describe("worker production-path source verification", () => {
  it("reports the real parsed item count and applies the >=3 gate", async () => {
    const fetchItems = vi
      .fn()
      .mockResolvedValueOnce([item, item, item])
      .mockResolvedValueOnce([item, item]);
    const pause = vi.fn().mockResolvedValue(undefined);
    const robotsCheck = vi.fn().mockResolvedValue(undefined);

    const results = await verifySourcesWithWorker(
      [makeSource(), makeSource({ id: 2, name: "不足三条" })],
      { fetchItems, robotsCheck, pause }
    );

    expect(results).toMatchObject([
      { status: "pass", itemCount: 3 },
      { status: "fail", itemCount: 2 }
    ]);
    expect(fetchItems).toHaveBeenCalledTimes(2);
    expect(robotsCheck).toHaveBeenCalledTimes(2);
    expect(fetchItems).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ useRealUa: true })
    );
    expect(pause).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledWith(1_000);
  });

  it("skips verificationBlocked sources without calling a fetcher", async () => {
    const fetchItems = vi.fn();
    const robotsCheck = vi.fn();
    const results = await verifySourcesWithWorker(
      [
        makeSource({
          config: {
            type: "html",
            verificationBlocked: true,
            verificationBlockedReason:
              "robots.txt explicitly disallows target path"
          }
        })
      ],
      { fetchItems, robotsCheck }
    );

    expect(results).toMatchObject([
      {
        status: "skipped",
        error: "robots.txt explicitly disallows target path"
      }
    ]);
    expect(fetchItems).not.toHaveBeenCalled();
    expect(robotsCheck).not.toHaveBeenCalled();
  });

  it("can probe a disabled source without mutating its enabled state", async () => {
    const source = Object.freeze(makeSource({ enabled: false }));
    const fetchItems = vi.fn().mockResolvedValue([item, item, item]);
    const robotsCheck = vi.fn().mockResolvedValue(undefined);

    const results = await verifySourcesWithWorker([source], {
      includeDisabled: true,
      fetchItems,
      robotsCheck
    });

    expect(results[0]).toMatchObject({
      sourceEnabled: false,
      status: "pass",
      itemCount: 3
    });
    expect(source.enabled).toBe(false);
  });

  it("checks robots against config.listUrl when it differs from the source URL", async () => {
    const robotsCheck = vi.fn().mockResolvedValue(undefined);
    const fetchItems = vi.fn().mockResolvedValue([item, item, item]);

    await verifySourcesWithWorker(
      [
        makeSource({
          url: "https://guangfu.bjx.com.cn/",
          fetcherType: "html",
          config: {
            type: "html",
            listUrl: "https://www.bjx.com.cn/"
          }
        })
      ],
      { fetchItems, robotsCheck }
    );

    expect(robotsCheck).toHaveBeenCalledWith(
      "https://www.bjx.com.cn/",
      expect.any(String)
    );
  });

  it("checks rss robots against config.url when it differs from the source URL", async () => {
    const robotsCheck = vi.fn().mockResolvedValue(undefined);
    const fetchItems = vi.fn().mockResolvedValue([item, item, item]);

    await verifySourcesWithWorker(
      [
        makeSource({
          name: "第一财经 头条",
          url: "https://www.yicai.com/news/energy/",
          fetcherType: "rss",
          config: {
            type: "rss",
            url: "http://rsshub:1200/yicai/headline"
          }
        })
      ],
      { fetchItems, robotsCheck }
    );

    expect(robotsCheck).toHaveBeenCalledWith(
      "http://rsshub:1200/yicai/headline",
      expect.any(String)
    );
  });

  it("rejects an empty html listUrl instead of silently probing source.url", async () => {
    const robotsCheck = vi.fn();
    const fetchItems = vi.fn();

    const results = await verifySourcesWithWorker(
      [
        makeSource({
          fetcherType: "html",
          config: { type: "html", listUrl: "" }
        })
      ],
      { fetchItems, robotsCheck }
    );

    expect(results).toMatchObject([
      { status: "fail", error: "config.listUrl must not be empty" }
    ]);
    expect(robotsCheck).not.toHaveBeenCalled();
    expect(fetchItems).not.toHaveBeenCalled();
  });

  it("rejects an empty rss config.url instead of silently probing source.url", async () => {
    const robotsCheck = vi.fn();
    const fetchItems = vi.fn();

    const results = await verifySourcesWithWorker(
      [
        makeSource({
          fetcherType: "rss",
          config: { type: "rss", url: "" }
        })
      ],
      { fetchItems, robotsCheck }
    );

    expect(results).toMatchObject([
      { status: "fail", error: "config.url must not be empty" }
    ]);
    expect(robotsCheck).not.toHaveBeenCalled();
    expect(fetchItems).not.toHaveBeenCalled();
  });
});

describe("worker verify-sources CLI flags and JSONL output (T-G0-02a)", () => {
  const pass: DeepVerifyResult = {
    id: 7,
    name: "国家能源局",
    url: "https://www.nea.gov.cn/xwzx/nyyw.htm",
    fetcherType: "announcement",
    sourceEnabled: true,
    status: "pass",
    itemCount: 3
  };

  it("parses a positive source id and rejects invalid values", () => {
    expect(parseSourceIdArg([])).toBeNull();
    expect(parseSourceIdArg(["--source-id", "42"])).toBe(42);
    for (const value of [undefined, "", "0", "-1", "3.14", "12abc"]) {
      const argv =
        value === undefined ? ["--source-id"] : ["--source-id", value];
      expect(() => parseSourceIdArg(argv)).toThrow(/positive integer/);
    }
  });

  it("filters to one source and returns empty for an unknown id", () => {
    const sources = [makeSource({ id: 10 }), makeSource({ id: 11 })];
    expect(filterSourcesById(sources, 11)).toEqual([sources[1]]);
    expect(filterSourcesById(sources, 999)).toEqual([]);
  });

  it("emits one JSON result line plus a final summary", () => {
    const failed: DeepVerifyResult = {
      ...pass,
      id: 8,
      status: "fail",
      error: "failed"
    };
    expect(JSON.parse(toJsonlResult(pass))).toMatchObject({
      kind: "result",
      id: 7
    });
    expect(JSON.parse(toJsonlSummary([pass, failed]))).toEqual({
      kind: "summary",
      passed: 1,
      failed: 1,
      skipped: 0,
      total: 2
    });

    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    printJsonlResults([pass, failed]);
    const lines = write.mock.calls
      .map(([chunk]) => String(chunk).trim())
      .filter(Boolean);
    write.mockRestore();
    expect(lines.map((line) => JSON.parse(line).kind)).toEqual([
      "result",
      "result",
      "summary"
    ]);
  });

  it("keeps default text output compatible", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    printResults([pass]);
    expect(log.mock.calls.map(([line]) => String(line))).toEqual([
      "PASS\t国家能源局\tannouncement\thttps://www.nea.gov.cn/xwzx/nyyw.htm items=3",
      "worker-content-verification passed=1 failed=0 skipped=0"
    ]);
    log.mockRestore();
  });
});
