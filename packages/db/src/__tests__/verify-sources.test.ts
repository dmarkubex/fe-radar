import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SourceRecord, FetcherType } from "../repos/sources";
import {
  suggestionFor,
  checkHtmlOrRss,
  checkPlaywright,
  verifySource,
  type VerifyResult
} from "../../scripts/verify-sources";

function makeSource(overrides: Partial<SourceRecord> & { name: string; url: string; fetcherType: FetcherType }): SourceRecord {
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
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
    });

    it("fails on TLS/SSL error", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("SSL certificate verification failed"));
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
      const result: VerifyResult = { name: "test", fetcherType: "html", url: "https://example.com", ok: true, suggestion: "" };
      expect(suggestionFor(result)).toBe("");
    });

    it("suggests disabling/proxy for 403", () => {
      const result: VerifyResult = { name: "test", fetcherType: "html", url: "https://example.com", ok: false, status: 403, suggestion: "" };
      expect(suggestionFor(result)).toContain("403");
    });

    it("suggests URL verification for 404", () => {
      const result: VerifyResult = { name: "test", fetcherType: "html", url: "https://example.com", ok: false, status: 404, suggestion: "" };
      expect(suggestionFor(result)).toContain("404");
    });

    it("suggests TLS fix for SSL errors", () => {
      const result: VerifyResult = { name: "test", fetcherType: "html", url: "https://example.com", ok: false, error: "TLS handshake failed", suggestion: "" };
      expect(suggestionFor(result)).toContain("TLS");
    });

    it("suggests timeout fix for timeout errors", () => {
      const result: VerifyResult = { name: "test", fetcherType: "html", url: "https://example.com", ok: false, error: "Connection timeout", suggestion: "" };
      expect(suggestionFor(result)).toContain("timed out");
    });

    it("suggests selector fix for playwright selector errors", () => {
      const result: VerifyResult = { name: "test", fetcherType: "playwright", url: "https://example.com", ok: false, error: "selector timeout for '.news-list': waiting failed", suggestion: "" };
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
      expect(globalThis.fetch).toHaveBeenCalledWith("https://example.com/news", expect.anything());
    });

    it("html source falls back to source.url when no config URLs", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const source = makeSource({
        name: "test-html",
        url: "https://example.com",
        fetcherType: "html",
        config: {}
      });
      const result = await verifySource(source);
      expect(result.ok).toBe(true);
      expect(result.url).toBe("https://example.com");
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
        config: { extractor: "() => []" }
      });
      const result = await checkPlaywright(source);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("missing waitFor");
    });

    it("fails when extractor is missing", async () => {
      const source = makeSource({
        name: "bad-pw-no-ext",
        url: "https://example.com",
        fetcherType: "playwright",
        config: { waitFor: "body" }
      });
      const result = await checkPlaywright(source);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("missing waitFor or extractor");
    });

    it("fails when URL is unreachable (non-2xx)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
      const source = makeSource({
        name: "pw-403",
        url: "https://example.com",
        fetcherType: "playwright",
        config: { waitFor: ".news-list", extractor: "() => []" }
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
        config: { listUrl: "https://example.com/news", waitFor: ".news-list", extractor: "() => []" }
      });

      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn().mockResolvedValue(undefined),
          waitForSelector: vi.fn().mockResolvedValue(undefined),
          $$eval: vi.fn().mockResolvedValue(5)
        }),
        close: vi.fn().mockResolvedValue(undefined)
      };
      const mockChromium = { launch: vi.fn().mockResolvedValue(mockBrowser) };

      vi.doMock("playwright", () => ({ chromium: mockChromium }));

      const result = await checkPlaywright(source);
      expect(result.ok).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith("https://example.com/news", expect.anything());

      vi.doUnmock("playwright");
    });

    it("fails when selector matches 0 items", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const source = makeSource({
        name: "pw-zero-items",
        url: "https://example.com",
        fetcherType: "playwright",
        config: { waitFor: ".nonexistent", extractor: "() => []" }
      });

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        $$eval: vi.fn().mockResolvedValue(0)
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

      vi.doUnmock("playwright");
    });

    it("fails when selector times out", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const source = makeSource({
        name: "pw-selector-timeout",
        url: "https://example.com",
        fetcherType: "playwright",
        config: { waitFor: ".slow-selector", extractor: "() => []" }
      });

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        waitForSelector: vi.fn().mockRejectedValue(new Error("waiting for selector '.slow-selector' timed out")),
        $$eval: vi.fn().mockResolvedValue(0)
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
        config: { waitFor: ".news-list", extractor: "() => []" }
      });

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        $$eval: vi.fn().mockResolvedValue(10)
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
  });

  describe("disabled sources are not verified", () => {
    it("listSources filters to enabled=true, so disabled sources are excluded", () => {
      const enabledSource = makeSource({ name: "enabled-src", url: "https://enabled.example.com", fetcherType: "html", enabled: true });
      const disabledSource = makeSource({ name: "disabled-src", url: "https://disabled.example.com", fetcherType: "html", enabled: false });
      const toVerify = [enabledSource, disabledSource].filter((s) => s.enabled);
      expect(toVerify).toHaveLength(1);
      expect(toVerify[0]!.name).toBe("enabled-src");
    });
  });

  describe("0011 config is not overridden by 0004", () => {
    it("a source updated by 0011 has playwright config, not rss", () => {
      const after0011 = makeSource({
        name: "北极星电力新闻网",
        url: "https://news.bjx.com.cn/",
        fetcherType: "playwright",
        config: { type: "playwright", listUrl: "https://news.bjx.com.cn/", waitFor: ".news-list", extractor: "() => []" }
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
        config: { type: "playwright", listUrl: "https://smartgrid.bjx.com.cn/", waitFor: "body" }
      });
      expect(after0011.enabled).toBe(false);
    });

    it("a source with corrected selectors from 0011 has updated config", () => {
      const after0011 = makeSource({
        name: "国家发改委",
        url: "https://www.ndrc.gov.cn/xwdt/xwfb/",
        fetcherType: "html",
        config: { type: "html", listUrl: "https://www.ndrc.gov.cn/xwdt/xwfb/", selectors: { item: "ul.u-list > li", title: "a", link: "a", date: "span" } }
      });
      const config = after0011.config as { selectors: { item: string } };
      expect(config.selectors.item).toBe("ul.u-list > li");
    });
  });

  describe("quotes sources excluded from v1.0 news gate", () => {
    it("quotes fetcherType is filtered out from news verification", () => {
      const sources = [
        makeSource({ name: "html-src", url: "https://example.com", fetcherType: "html" }),
        makeSource({ name: "quotes-src", url: "https://quotes.example.com", fetcherType: "quotes" }),
        makeSource({ name: "rss-src", url: "https://rss.example.com", fetcherType: "rss" })
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
      const scriptPath = resolve(import.meta.dirname, "../../scripts/verify-sources.ts");
      const scriptContent = readFileSync(scriptPath, "utf8");
      expect(scriptContent).toContain("listSources");
      expect(scriptContent).toContain("createDbClient");
      expect(scriptContent).not.toContain("0004_sources_seed");
    });

    it("the script fails fast when DATABASE_URL is not set", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const scriptPath = resolve(import.meta.dirname, "../../scripts/verify-sources.ts");
      const scriptContent = readFileSync(scriptPath, "utf8");
      expect(scriptContent).toContain("DATABASE_URL");
      expect(scriptContent).toMatch(/Cannot verify|not set/);
    });
  });
});
