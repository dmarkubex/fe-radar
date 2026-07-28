import type { FetcherType, SourceRecord } from "@fe-radar/db";
import { describe, expect, it, vi } from "vitest";

import { verifySourcesWithWorker } from "../verify-sources";

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
