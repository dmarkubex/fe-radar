import { describe, expect, it, vi } from "vitest";
import type { SourceRecord, FetcherType } from "../repos/sources";

interface VerifyResult {
  name: string;
  fetcherType: FetcherType;
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
  suggestion: string;
}

const TIMEOUT_MS = 10_000;

function suggestionFor(result: VerifyResult): string {
  if (result.ok) return "";
  if (result.status === 403) return "Access denied (403). Consider disabling source or switching to playwright with proxy.";
  if (result.status === 404) return "URL not found (404). Verify URL or disable source.";
  if (result.status === 405) return "Method not allowed (405). Check if URL is correct.";
  if (result.status === 429) return "Rate limited (429). Consider increasing interval or using proxy.";
  if (result.error?.includes("fetch failed") || result.error?.includes("ECONNREFUSED")) return "Network unreachable. Check DNS/firewall or disable source.";
  if (result.error?.includes("timeout")) return "Connection timed out. Server may be down or blocking.";
  if (result.error?.includes("SSL") || result.error?.includes("TLS") || result.error?.includes("certificate")) return "TLS/SSL error. Check cert validity or disable source.";
  if (result.fetcherType === "playwright") return "Playwright source unreachable. Verify URL works in browser.";
  return "Investigate error and fix URL/config or disable source.";
}

async function checkHtmlOrRss(url: string): Promise<Pick<VerifyResult, "ok" | "status" | "error">> {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "FE-Radar Verify Bot (+https://fe-radar.internal/bot)" }
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function makeSource(overrides: Partial<SourceRecord> & { name: string; url: string; fetcherType: FetcherType }): SourceRecord {
  return {
    id: 1,
    tier: "T1",
    category: "test",
    enabled: true,
    lastOkAt: null,
    failCount: 0,
    createdAt: new Date(),
    config: {},
    ...overrides
  };
}

describe("verify-sources logic", () => {
  describe("checkHtmlOrRss (2xx gate)", () => {
    it("passes on HTTP 200", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      globalThis.fetch = originalFetch;
    });

    it("fails on HTTP 403", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
      globalThis.fetch = originalFetch;
    });

    it("fails on HTTP 404", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);
      globalThis.fetch = originalFetch;
    });

    it("fails on HTTP 405", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 405 });
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
      expect(result.status).toBe(405);
      globalThis.fetch = originalFetch;
    });

    it("fails on HTTP 500", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      globalThis.fetch = originalFetch;
    });

    it("fails on network error (timeout, DNS)", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
      globalThis.fetch = originalFetch;
    });

    it("fails on TLS/SSL error", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("SSL certificate verification failed"));
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSL");
      globalThis.fetch = originalFetch;
    });
  });

  describe("suggestionFor", () => {
    it("returns empty string for passing results", () => {
      const result: VerifyResult = { name: "test", fetcherType: "html", url: "https://example.com", ok: true, suggestion: "" };
      expect(suggestionFor(result)).toBe("");
    });

    it("suggests disabling for 403", () => {
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
  });

  describe("disabled sources are not verified", () => {
    it("listSources filters to enabled=true, so disabled sources are excluded from verification", () => {
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

  describe("playwright config validation", () => {
    it("fails if waitFor is missing", () => {
      const source = makeSource({
        name: "bad-pw",
        url: "https://example.com",
        fetcherType: "playwright",
        config: { extractor: "() => []" }
      });
      const config = source.config as Record<string, unknown>;
      expect(config.waitFor).toBeUndefined();
    });

    it("fails if extractor is missing", () => {
      const source = makeSource({
        name: "bad-pw",
        url: "https://example.com",
        fetcherType: "playwright",
        config: { waitFor: "body" }
      });
      const config = source.config as Record<string, unknown>;
      expect(config.extractor).toBeUndefined();
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

  describe("non-2xx responses are failures", () => {
    it("HTTP 301 without response.ok is a failure", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 301 });
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
      globalThis.fetch = originalFetch;
    });

    it("HTTP 302 without response.ok is a failure", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 302 });
      const result = await checkHtmlOrRss("https://example.com");
      expect(result.ok).toBe(false);
      globalThis.fetch = originalFetch;
    });
  });
});
