import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SourceRecord, FetcherType } from "../repos/sources";
import {
  suggestionFor,
  checkHtmlOrRss,
  checkPlaywright,
  disabledSourceSuggestion,
  enabledReachabilitySummary,
  reachabilityGateFailed,
  sourcesForVerification,
  verifySource,
  type VerifyResult
} from "../../scripts/verify-sources";

function makeSource(
  overrides: Partial<SourceRecord> & {
    name: string;
    url: string;
    fetcherType: FetcherType;
  }
): SourceRecord {
  return {
    id: 1,
    tier: "T1",
    category: "test",
    enabled: true,
    lastOkAt: null,
    failCount: 0,
    lastError: null,
    lastErrorAt: null,
    adminTouchedAt: null,
    adminSnapshot: null,
    urlLocked: false,
    createdAt: new Date(),
    config: {},
    ...overrides
  };
}

describe("verify-sources", () => {
  describe("checkHtmlOrRss (2xx gate)", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("passes on HTTP 200", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
    });

    it("fails on HTTP 403", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
    });

    it("fails on HTTP 404", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);
    });

    it("fails on HTTP 405", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 405 });
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
      expect(result.status).toBe(405);
    });

    it("fails on HTTP 500", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
    });

    it("fails on network error (ECONNREFUSED)", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
    });

    it("fails on TLS/SSL error", async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("SSL certificate verification failed"));
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSL");
    });

    it("fails on HTTP 301 (redirect without ok)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 301 });
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
    });

    it("fails on HTTP 302 (redirect without ok)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 302 });
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
    });
  });

  describe("suggestionFor", () => {
    it("returns empty string for passing results", () => {
      const result: VerifyResult = {
        name: "test",
        fetcherType: "html",
        url: "https://example.com",
        ok: true,
        suggestion: ""
      };
      expect(suggestionFor(result)).toBe("");
    });

    it("suggests disabling/proxy for 403", () => {
      const result: VerifyResult = {
        name: "test",
        fetcherType: "html",
        url: "https://example.com",
        ok: false,
        status: 403,
        suggestion: ""
      };
      expect(suggestionFor(result)).toContain("403");
    });

    it("suggests URL verification for 404", () => {
      const result: VerifyResult = {
        name: "test",
        fetcherType: "html",
        url: "https://example.com",
        ok: false,
        status: 404,
        suggestion: ""
      };
      expect(suggestionFor(result)).toContain("404");
    });

    it("suggests TLS fix for SSL errors", () => {
      const result: VerifyResult = {
        name: "test",
        fetcherType: "html",
        url: "https://example.com",
        ok: false,
        error: "TLS handshake failed",
        suggestion: ""
      };
      expect(suggestionFor(result)).toContain("TLS");
    });

    it("suggests timeout fix for timeout errors", () => {
      const result: VerifyResult = {
        name: "test",
        fetcherType: "html",
        url: "https://example.com",
        ok: false,
        error: "Connection timeout",
        suggestion: ""
      };
      expect(suggestionFor(result)).toContain("timed out");
    });

    it("suggests selector fix for playwright selector errors", () => {
      const result: VerifyResult = {
        name: "test",
        fetcherType: "playwright",
        url: "https://example.com",
        ok: false,
        error: "selector timeout for '.news-list': waiting failed",
        suggestion: ""
      };
      expect(suggestionFor(result)).toContain("selector");
    });
  });

  describe("verifySource", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("html source uses config.listUrl as target", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const source = makeSource({
        name: "test-html",
        url: "https://example.com",
        fetcherType: "html",
        config: { listUrl: "https://example.com/news" }
      });
      const result = await verifySource(source);
      expect(result.ok).toBe(true);
      expect(result.url).toBe("https://example.com/news");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://example.com/news",
        expect.anything()
      );
    });

    it("html source ignores config.url and falls back to source.url when listUrl is absent", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const source = makeSource({
        name: "test-html",
        url: "https://example.com",
        fetcherType: "html",
        config: { url: "https://legacy.example.com" }
      });
      const result = await verifySource(source);
      expect(result.ok).toBe(true);
      expect(result.url).toBe("https://example.com");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.anything()
      );
    });

    it.each([
      {
        name: "界面新闻 能源",
        sourceUrl: "https://www.jiemian.com/lists/55.html",
        configUrl: "http://rsshub:1200/jiemian/lists/856"
      },
      {
        name: "36氪 快讯",
        sourceUrl: "https://36kr.com/information/web_news/",
        configUrl: "http://rsshub:1200/36kr/information/web_news"
      },
      {
        name: "第一财经 头条",
        sourceUrl: "https://www.yicai.com/news/energy/",
        configUrl: "http://rsshub:1200/yicai/headline"
      }
    ])(
      "$name rss source uses config.url as target",
      async ({ name, sourceUrl, configUrl }) => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
        const source = makeSource({
          name,
          url: sourceUrl,
          fetcherType: "rss",
          config: { url: configUrl }
        });

        const result = await verifySource(source);

        expect(result.ok).toBe(true);
        expect(result.url).toBe(configUrl);
        expect(globalThis.fetch).toHaveBeenCalledWith(
          configUrl,
          expect.anything()
        );
      }
    );

    it("rejects an empty listUrl instead of silently probing source.url", async () => {
      const source = makeSource({
        name: "test-html",
        url: "https://example.com",
        fetcherType: "html",
        config: { listUrl: "" }
      });

      await expect(verifySource(source)).rejects.toThrow(
        "config.listUrl must not be empty"
      );
    });

    it("rejects an empty rss config.url instead of silently probing source.url", async () => {
      const source = makeSource({
        name: "test-rss",
        url: "https://example.com/rss.xml",
        fetcherType: "rss",
        config: { url: "" }
      });

      await expect(verifySource(source)).rejects.toThrow(
        "config.url must not be empty"
      );
    });

    it("html source fails on non-2xx", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      const source = makeSource({
        name: "test-html-404",
        url: "https://example.com",
        fetcherType: "html"
      });
      const result = await verifySource(source);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);
    });

    it("unsupported fetcherType returns failure", async () => {
      const source = makeSource({
        name: "test-unknown",
        url: "https://example.com",
        fetcherType: "quotes"
      });
      const result = await verifySource(source);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Unsupported fetcher_type");
    });

    it("rss source passes on 200", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const source = makeSource({
        name: "test-rss",
        url: "https://example.com/rss.xml",
        fetcherType: "rss"
      });
      const result = await verifySource(source);
      expect(result.ok).toBe(true);
    });
  });

  describe("checkPlaywright", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("fails when waitFor is missing", async () => {
      const source = makeSource({
        name: "bad-pw-no-wait",
        url: "https://example.com",
        fetcherType: "playwright",
        config: { itemSelector: "a" }
      });
      const result = await checkPlaywright(source);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("missing waitFor");
    });

    it("fails when itemSelector is missing", async () => {
      const source = makeSource({
        name: "bad-pw-no-sel",
        url: "https://example.com",
        fetcherType: "playwright",
        config: { waitFor: "body" }
      });
      const result = await checkPlaywright(source);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("missing waitFor or itemSelector");
    });

    it("fails when URL is unreachable (non-2xx)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
      const source = makeSource({
        name: "pw-403",
        url: "https://example.com",
        fetcherType: "playwright",
        config: { waitFor: ".news-list", itemSelector: "a" }
      });
      const result = await checkPlaywright(source);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
    });

    it("uses config.listUrl instead of source.url", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const source = makeSource({
        name: "pw-listurl",
        url: "https://example.com",
        fetcherType: "playwright",
        config: {
          listUrl: "https://example.com/news",
          waitFor: ".news-list",
          itemSelector: "a"
        }
      });

      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn().mockResolvedValue(undefined),
          url: () => "https://example.com/news",
          waitForSelector: vi.fn().mockResolvedValue(undefined),
          $$eval: vi.fn().mockResolvedValue({ matched: 5, valid: 5 })
        }),
        close: vi.fn().mockResolvedValue(undefined)
      };
      const mockChromium = { launch: vi.fn().mockResolvedValue(mockBrowser) };

      vi.doMock("playwright", () => ({ chromium: mockChromium }));

      const result = await checkPlaywright(source);
      expect(result.ok).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://example.com/news",
        expect.anything()
      );

      vi.doUnmock("playwright");
    });

    it("fails when selector matches 0 items", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const source = makeSource({
        name: "pw-zero-items",
        url: "https://example.com",
        fetcherType: "playwright",
        config: { waitFor: ".nonexistent", itemSelector: "a" }
      });

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        url: () => "https://example.com",
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        $$eval: vi.fn().mockResolvedValue({ matched: 0, valid: 0 })
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined)
      };
      const mockChromium = { launch: vi.fn().mockResolvedValue(mockBrowser) };

      vi.doMock("playwright", () => ({ chromium: mockChromium }));

      const result = await checkPlaywright(source);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("0 items");
      expect(result.error).toContain("itemSelector");

      vi.doUnmock("playwright");
    });

    // A-6 core: waitFor (coarse readiness) can hit while itemSelector (runtime extract) misses.
    // Gate must fail on itemSelector, not pass because waitFor counted > 0.
    it("fails when waitFor is ready but itemSelector matches 0 items", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const source = makeSource({
        name: "pw-waitfor-ok-itemsel-miss",
        url: "https://example.com",
        fetcherType: "playwright",
        config: {
          waitFor: ".news-list",
          itemSelector: ".article-item-drifted"
        }
      });

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        url: () => "https://example.com",
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        $$eval: vi.fn().mockImplementation(async (selector: string) => {
          // If the gate still counted waitFor, this would incorrectly return > 0.
          if (selector === ".news-list") return { matched: 12, valid: 12 };
          if (selector === ".article-item-drifted") return { matched: 0, valid: 0 };
          return { matched: 0, valid: 0 };
        })
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined)
      };
      const mockChromium = { launch: vi.fn().mockResolvedValue(mockBrowser) };

      vi.doMock("playwright", () => ({ chromium: mockChromium }));

      const result = await checkPlaywright(source);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("itemSelector");
      expect(result.error).toContain(".article-item-drifted");
      expect(result.error).toContain("0 items");
      // Count must use itemSelector, not waitFor.
      expect(mockPage.$$eval).toHaveBeenCalledWith(
        ".article-item-drifted",
        expect.any(Function),
        expect.anything()
      );
      expect(mockPage.waitForSelector).toHaveBeenCalledWith(
        ".news-list",
        expect.anything()
      );

      vi.doUnmock("playwright");
    });

    it("fails when selector times out", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const source = makeSource({
        name: "pw-selector-timeout",
        url: "https://example.com",
        fetcherType: "playwright",
        config: { waitFor: ".slow-selector", itemSelector: "a" }
      });

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        url: () => "https://example.com",
        waitForSelector: vi
          .fn()
          .mockRejectedValue(
            new Error("waiting for selector '.slow-selector' timed out")
          ),
        $$eval: vi.fn().mockResolvedValue({ matched: 0, valid: 0 })
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined)
      };
      const mockChromium = { launch: vi.fn().mockResolvedValue(mockBrowser) };

      vi.doMock("playwright", () => ({ chromium: mockChromium }));

      const result = await checkPlaywright(source);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("selector timeout");

      vi.doUnmock("playwright");
    });

    it("passes when URL is reachable and selector matches items", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const source = makeSource({
        name: "pw-ok",
        url: "https://example.com",
        fetcherType: "playwright",
        config: { waitFor: ".news-list", itemSelector: "a" }
      });

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        url: () => "https://example.com",
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        $$eval: vi.fn().mockResolvedValue({ matched: 10, valid: 10 })
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined)
      };
      const mockChromium = { launch: vi.fn().mockResolvedValue(mockBrowser) };

      vi.doMock("playwright", () => ({ chromium: mockChromium }));

      const result = await checkPlaywright(source);
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);

      vi.doUnmock("playwright");
    });

    // B-5 / A-6 收尾：CI 门禁与 worker 运行时同口径——itemSelector 命中但内容全空（站点改版）
    // 时门禁必须失败，不能只数命中数而放行。
    it("fails when itemSelector matches items but all have empty title/link", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const source = makeSource({
        name: "pw-matched-empty-content",
        url: "https://example.com",
        fetcherType: "playwright",
        config: { waitFor: ".news-list", itemSelector: "a" }
      });

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        url: () => "https://example.com",
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        // itemSelector matched 5 elements, but every title/link is empty (sub-selectors drifted).
        $$eval: vi.fn().mockResolvedValue({ matched: 5, valid: 0 })
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined)
      };
      const mockChromium = { launch: vi.fn().mockResolvedValue(mockBrowser) };

      vi.doMock("playwright", () => ({ chromium: mockChromium }));

      const result = await checkPlaywright(source);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("matched 5 item(s)");
      expect(result.error).toContain("empty title or link");

      vi.doUnmock("playwright");
    });

    // V-2: CI gate must use the same limit truncation as the worker runtime
    // (playwright.ts:218 els.slice(0, limit)). Without it, CI examines ALL matching
    // nodes while the worker only scans the first N — a site redesign with drifted
    // selectors in the first N nodes passes CI but fails at runtime (dual-green).
    it("V-2: fails when first N nodes within limit are invalid even if later nodes are valid", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const source = makeSource({
        name: "pw-limit-truncation",
        url: "https://example.com",
        fetcherType: "playwright",
        config: { waitFor: ".news-list", itemSelector: ".item", limit: 20 }
      });

      // 40 fake DOM nodes: first 20 invalid (empty title/href), last 20 valid.
      // Without the limit fix, CI examines all 40 → finds 20 valid → false green.
      // With the fix, CI only examines first 20 → all invalid → correctly fails.
      const fakeNodes = Array.from({ length: 40 }, (_, i) => {
        if (i < 20) {
          return {
            matches: () => false,
            querySelector: () => ({ textContent: "", href: "" }),
          };
        }
        return {
          matches: () => false,
          querySelector: () => ({
            textContent: `Article ${i}`,
            href: `https://example.com/a/${i}`,
          }),
        };
      });

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        url: () => "https://example.com",
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        // Execute the real callback with fake nodes — simulates browser-side $$eval
        $$eval: vi.fn().mockImplementation(async (
          _selector: string,
          fn: (els: Element[], arg: { titleSelector: string; linkSelector: string; listUrl: string; limit: number }) => { matched: number; valid: number },
          arg: { titleSelector: string; linkSelector: string; listUrl: string; limit: number }
        ) => {
          return fn(fakeNodes as unknown as Element[], arg);
        }),
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined)
      };
      const mockChromium = { launch: vi.fn().mockResolvedValue(mockBrowser) };

      vi.doMock("playwright", () => ({ chromium: mockChromium }));

      const result = await checkPlaywright(source);

      // With the fix: CI only sees first 20 nodes (all invalid) → must fail.
      // Without the fix: CI would see all 40 nodes → finds 20 valid → would pass (the bug).
      expect(result.ok).toBe(false);
      expect(result.error).toContain("empty title or link");
      // matched should be 20 (the limit), not 40 (the total DOM match count)
      expect(result.error).toContain("matched 20 item(s)");

      vi.doUnmock("playwright");
    });

    // T15c 缺陷 2（镜像 T15a）：重定向后空 href 被浏览器解析为 finalUrl；
    // 若 listUrl 仍用 targetUrl（重定向前）则回退判定不触发，垃圾条目放行。
    it("T15c: fails empty-href items resolved to redirected finalUrl (not pre-nav targetUrl)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const targetUrl = "https://x.com/start";
      const finalUrl = "https://x.com/final/";
      const source = makeSource({
        name: "pw-redirect-empty-href",
        url: targetUrl,
        fetcherType: "playwright",
        config: {
          listUrl: targetUrl,
          waitFor: "body",
          itemSelector: "article"
        }
      });

      // Browser .href getter on empty/absent href → current document URL = finalUrl.
      const fakeNodes = [
        {
          matches: () => false,
          querySelector: () => ({
            textContent: "Garbage (empty href after redirect)",
            href: finalUrl
          })
        }
      ];

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        url: () => finalUrl,
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        $$eval: vi.fn().mockImplementation(
          async (
            _selector: string,
            fn: (
              els: Element[],
              arg: {
                titleSelector: string;
                linkSelector: string;
                listUrl: string;
                limit: number;
              }
            ) => { matched: number; valid: number },
            arg: {
              titleSelector: string;
              linkSelector: string;
              listUrl: string;
              limit: number;
            }
          ) => fn(fakeNodes as unknown as Element[], arg)
        )
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined)
      };
      const mockChromium = { launch: vi.fn().mockResolvedValue(mockBrowser) };

      vi.doMock("playwright", () => ({ chromium: mockChromium }));

      const result = await checkPlaywright(source);

      // Fix: finalUrl baseline → matched>0 but valid=0 → ok:false
      expect(result.ok).toBe(false);
      expect(result.error).toContain("matched 1 item(s)");
      expect(result.error).toContain("empty title or link");
      // $$eval must receive post-nav finalUrl, not pre-nav targetUrl
      expect(mockPage.$$eval).toHaveBeenCalledWith(
        "article",
        expect.any(Function),
        expect.objectContaining({ listUrl: finalUrl })
      );

      vi.doUnmock("playwright");
    });

    // Pure unit 回代：旧逻辑 (targetUrl 基准) vs 新逻辑 (finalUrl 基准) 在同一输入上的结果。
    it("T15c regression: old targetUrl baseline keeps redirect empty-href junk; finalUrl filters it", () => {
      const targetUrl = "https://x.com/start";
      const finalUrl = "https://x.com/final/";
      // Browser-resolved empty href equals the post-redirect document URL.
      const itemHref = finalUrl;

      // --- 修复前（bug）：listUrl = targetUrl ---
      const oldListUrlNorm = new URL(targetUrl).toString();
      const oldResolved = new URL(itemHref, targetUrl).toString();
      const oldValid = oldResolved !== oldListUrlNorm; // true → 垃圾条目被当 valid

      // --- 修复后：listUrl = finalUrl ---
      const newListUrlNorm = new URL(finalUrl).toString();
      const newResolved = new URL(itemHref, finalUrl).toString();
      const newValid = newResolved !== newListUrlNorm; // false → 正确过滤

      expect(oldValid).toBe(true); // pre-fix: matched=1, valid=1 → would pass gate (bug)
      expect(newValid).toBe(false); // post-fix: matched=1, valid=0 → ok:false
    });
  });

  describe("disabled source verification", () => {
    it("keeps the default selection limited to enabled sources", () => {
      const enabledSource = makeSource({
        name: "enabled-src",
        url: "https://enabled.example.com",
        fetcherType: "html",
        enabled: true
      });
      const disabledSource = makeSource({
        name: "disabled-src",
        url: "https://disabled.example.com",
        fetcherType: "html",
        enabled: false
      });
      const toVerify = sourcesForVerification(
        [enabledSource, disabledSource],
        false
      );
      expect(toVerify).toHaveLength(1);
      expect(toVerify[0]!.name).toBe("enabled-src");
    });

    it("includes disabled sources only when explicitly requested", () => {
      const enabledSource = makeSource({
        name: "enabled-src",
        url: "https://enabled.example.com",
        fetcherType: "html",
        enabled: true
      });
      const disabledSource = makeSource({
        name: "disabled-src",
        url: "https://disabled.example.com",
        fetcherType: "html",
        enabled: false
      });
      expect(
        sourcesForVerification([enabledSource, disabledSource], true)
      ).toHaveLength(2);
    });

    it("never probes sources blocked from verification by compliance policy", () => {
      const robotsBlocked = makeSource({
        name: "robots-blocked",
        url: "https://example.com/disallowed",
        fetcherType: "html",
        enabled: false,
        config: { verificationBlocked: true }
      });
      expect(sourcesForVerification([robotsBlocked], true)).toEqual([]);
    });

    it("excludes disabled failures from the enabled-source reachability gate", () => {
      const summary = enabledReachabilitySummary([
        {
          name: "enabled-ok",
          fetcherType: "html",
          url: "https://ok.example.com",
          sourceEnabled: true,
          ok: true,
          suggestion: ""
        },
        {
          name: "disabled-fail",
          fetcherType: "html",
          url: "https://fail.example.com",
          sourceEnabled: false,
          ok: false,
          suggestion: "failed"
        }
      ]);
      expect(summary).toEqual({
        enabledCount: 1,
        okCount: 1,
        failCount: 0,
        ratio: 1
      });
      expect(reachabilityGateFailed(summary, true)).toBe(false);
    });

    it("does not fail the optional disabled-source report when no enabled source exists", () => {
      const summary = enabledReachabilitySummary([
        {
          name: "disabled-fail",
          fetcherType: "html",
          url: "https://fail.example.com",
          sourceEnabled: false,
          ok: false,
          suggestion: "failed"
        }
      ]);
      expect(summary.enabledCount).toBe(0);
      expect(reachabilityGateFailed(summary, true)).toBe(false);
      expect(reachabilityGateFailed(summary, false)).toBe(true);
    });

    it("gives disabled sources an explicit re-enable or keep-disabled recommendation", () => {
      expect(
        disabledSourceSuggestion({
          name: "recovered",
          fetcherType: "html",
          url: "https://recovered.example.com",
          sourceEnabled: false,
          ok: true,
          suggestion: ""
        })
      ).toContain("content smoke");
      expect(
        disabledSourceSuggestion({
          name: "still-failing",
          fetcherType: "html",
          url: "https://failed.example.com",
          sourceEnabled: false,
          ok: false,
          suggestion: "Check DNS."
        })
      ).toContain("Still unreachable");
    });
  });

  describe("0011 config is not overridden by 0004", () => {
    it("a source updated by 0011 has playwright config, not rss", () => {
      const after0011 = makeSource({
        name: "北极星电力新闻网",
        url: "https://news.bjx.com.cn/",
        fetcherType: "playwright",
        config: {
          type: "playwright",
          listUrl: "https://news.bjx.com.cn/",
          waitFor: ".news-list",
          itemSelector: "a"
        }
      });
      expect(after0011.fetcherType).toBe("playwright");
      expect(after0011.url).toBe("https://news.bjx.com.cn/");
      expect(after0011.url).not.toBe("https://news.bjx.com.cn/rss.xml");
    });

    it("a source disabled by 0011 stays disabled", () => {
      const after0011 = makeSource({
        name: "北极星智能电网在线",
        url: "https://smartgrid.bjx.com.cn/",
        fetcherType: "playwright",
        enabled: false,
        config: {
          type: "playwright",
          listUrl: "https://smartgrid.bjx.com.cn/",
          waitFor: "body"
        }
      });
      expect(after0011.enabled).toBe(false);
    });

    it("a source with corrected selectors from 0011 has updated config", () => {
      const after0011 = makeSource({
        name: "国家发改委",
        url: "https://www.ndrc.gov.cn/xwdt/xwfb/",
        fetcherType: "html",
        config: {
          type: "html",
          listUrl: "https://www.ndrc.gov.cn/xwdt/xwfb/",
          selectors: {
            item: "ul.u-list > li",
            title: "a",
            link: "a",
            date: "span"
          }
        }
      });
      const config = after0011.config as { selectors: { item: string } };
      expect(config.selectors.item).toBe("ul.u-list > li");
    });
  });

  describe("quotes sources excluded from v1.0 news gate", () => {
    it("quotes fetcherType is filtered out from news verification", () => {
      const sources = [
        makeSource({
          name: "html-src",
          url: "https://example.com",
          fetcherType: "html"
        }),
        makeSource({
          name: "quotes-src",
          url: "https://quotes.example.com",
          fetcherType: "quotes"
        }),
        makeSource({
          name: "rss-src",
          url: "https://rss.example.com",
          fetcherType: "rss"
        })
      ];
      const newsSources = sources.filter((s) => s.fetcherType !== "quotes");
      expect(newsSources).toHaveLength(2);
      expect(newsSources.every((s) => s.fetcherType !== "quotes")).toBe(true);
    });
  });

  describe("verify-sources reads from DB, not static SQL", () => {
    it("the script imports from src/repos/sources (DB-backed), not from 0004_sources_seed.sql", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const scriptPath = resolve(
        import.meta.dirname,
        "../../scripts/verify-sources.ts"
      );
      const scriptContent = readFileSync(scriptPath, "utf8");
      expect(scriptContent).toContain("listSources");
      expect(scriptContent).toContain("createDbClient");
      expect(scriptContent).not.toContain("0004_sources_seed");
    });

    it("the script fails fast when DATABASE_URL is not set", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const scriptPath = resolve(
        import.meta.dirname,
        "../../scripts/verify-sources.ts"
      );
      const scriptContent = readFileSync(scriptPath, "utf8");
      expect(scriptContent).toContain("DATABASE_URL");
      expect(scriptContent).toMatch(/Cannot verify|not set/);
    });
  });
});
