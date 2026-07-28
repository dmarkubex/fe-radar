import { describe, expect, it } from "vitest";
import { SourceFetchError } from "@fe-radar/shared";
import {
  fetchNeaNews,
  mapNeaNewsResponse,
  resolveNeaNewsEndpoint
} from "../nea-news";
import type { AnnouncementSourceConfig, FetchContext } from "../../types";

const endpoint =
  "https://www.nea.gov.cn/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json";

const config: AnnouncementSourceConfig = {
  type: "announcement",
  adapter: "nea-news",
  endpoint
};

const ctx = { sourceName: "国家能源局", useRealUa: true } as FetchContext;

function respondWith(body: string): typeof fetch {
  return (async () =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as unknown as typeof fetch;
}

describe("nea-news adapter", () => {
  it("maps valid records and resolves article URLs against the JSON endpoint", () => {
    const items = mapNeaNewsResponse(
      {
        datasource: [
          {
            showTitle: "全国统一电力市场建设按下“加速键”",
            publishUrl: "../20260724/example/c.html",
            publishTime: "2026-07-24 14:19:41",
            contentType: "MultiMedia"
          }
        ]
      },
      endpoint
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "全国统一电力市场建设按下“加速键”",
      url: "https://www.nea.gov.cn/20260724/example/c.html",
      content: "全国统一电力市场建设按下“加速键”"
    });
    expect(items[0]!.publishedAt.toISOString()).toBe(
      "2026-07-24T06:19:41.000Z"
    );
  });

  it("drops link placeholders, malformed dates, and incomplete rows", () => {
    const items = mapNeaNewsResponse(
      {
        datasource: [
          null,
          {
            showTitle: "外链",
            publishUrl: "https://example.com",
            publishTime: "2026-07-24 10:00:00",
            contentType: "Link"
          },
          {
            showTitle: "坏日期",
            publishUrl: "../bad/c.html",
            publishTime: "not-a-date"
          },
          {
            showTitle: "坏链接",
            publishUrl: "https://[invalid",
            publishTime: "2026-07-24 10:00:00"
          },
          {
            publishUrl: "../missing-title/c.html",
            publishTime: "2026-07-24 10:00:00"
          }
        ]
      },
      endpoint
    );
    expect(items).toEqual([]);
  });

  it("strips title markup and respects the configured page size", () => {
    const items = mapNeaNewsResponse(
      {
        datasource: [
          {
            showTitle: "<em>能源</em>要闻",
            publishUrl: "../one/c.html",
            publishTime: "2026-07-24 10:00:00"
          },
          {
            showTitle: "第二条",
            publishUrl: "../two/c.html",
            publishTime: "2026-07-24 09:00:00"
          }
        ]
      },
      endpoint,
      1
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("能源要闻");
  });

  it("rejects non-allowlisted endpoints", () => {
    expect(() =>
      resolveNeaNewsEndpoint({
        type: "announcement",
        adapter: "nea-news",
        endpoint: "https://example.com/news.json"
      })
    ).toThrow(/allowlisted/);
  });

  it("accepts any ds_<hash>.json under the same column when upstream republishes", () => {
    // The datasource hash changes on republish; pinning one hash would break the source.
    expect(
      resolveNeaNewsEndpoint({
        type: "announcement",
        adapter: "nea-news",
        endpoint: `https://www.nea.gov.cn/xwzx/ds_${"a1b2c3d4".repeat(4)}.json`
      })
    ).toBe(`https://www.nea.gov.cn/xwzx/ds_${"a1b2c3d4".repeat(4)}.json`);
  });

  it("still rejects a same-host path outside the datasource convention", () => {
    for (const bad of [
      "https://www.nea.gov.cn/xwzx/../secrets.json",
      "https://www.nea.gov.cn/other/ds_8839d76f7cb542ca8cbaab7122cc9b83.json",
      "https://www.nea.gov.cn/xwzx/ds_short.json",
      "http://www.nea.gov.cn/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json"
    ]) {
      expect(() =>
        resolveNeaNewsEndpoint({
          type: "announcement",
          adapter: "nea-news",
          endpoint: bad
        })
      ).toThrow(/allowlisted/);
    }
  });

  it("rejects non-default ports (different origin on the same host)", () => {
    for (const bad of [
      "https://www.nea.gov.cn:444/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json",
      "https://www.nea.gov.cn:8443/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json"
    ]) {
      expect(() =>
        resolveNeaNewsEndpoint({
          type: "announcement",
          adapter: "nea-news",
          endpoint: bad
        })
      ).toThrow(/allowlisted/);
    }
  });

  it("rejects endpoints with embedded credentials (Node fetch cannot construct them)", () => {
    for (const bad of [
      "https://user:pass@www.nea.gov.cn/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json",
      "https://user@www.nea.gov.cn/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json",
      // password-only: username="" password="pass" — must hit password !== "" clause
      "https://:pass@www.nea.gov.cn/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json"
    ]) {
      expect(() =>
        resolveNeaNewsEndpoint({
          type: "announcement",
          adapter: "nea-news",
          endpoint: bad
        })
      ).toThrow(/allowlisted/);
    }
  });

  it("still accepts default-port endpoints with optional query/hash", () => {
    // query/hash do not change host/port/path destination; intentionally allowed.
    expect(
      resolveNeaNewsEndpoint({
        type: "announcement",
        adapter: "nea-news",
        endpoint:
          "https://www.nea.gov.cn/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json?v=1#frag"
      })
    ).toBe(
      "https://www.nea.gov.cn/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json?v=1#frag"
    );
  });

  it("raises FETCH_PARSE when the endpoint does not return JSON", async () => {
    await expect(
      fetchNeaNews(config, ctx, respondWith("<html>WAF challenge</html>"))
    ).rejects.toMatchObject({
      code: "FETCH_PARSE"
    });
  });

  it("raises FETCH_JSON_EMPTY when no row survives validation", async () => {
    const error = await fetchNeaNews(
      config,
      ctx,
      respondWith(
        JSON.stringify({
          datasource: [
            { showTitle: "外链", publishUrl: "https://x.test", contentType: "Link" },
            { showTitle: "坏日期", publishUrl: "../a/c.html", publishTime: "nope" }
          ]
        })
      )
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(SourceFetchError);
    expect(error).toMatchObject({ code: "FETCH_JSON_EMPTY" });
  });
});
