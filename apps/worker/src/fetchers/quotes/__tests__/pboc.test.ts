import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { pbocAdapter } from "../pboc";

const FIXTURES = join(__dirname, "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

// Mock the http module so we can inject fixture HTML without real network calls
vi.mock("../../http", () => ({
  fetchTextWithPolicy: vi.fn(),
}));

// Mock robots.ts (required by http.ts at module load in some configs)
vi.mock("../../../lib/robots", () => ({
  assertRobotsAllowed: vi.fn().mockResolvedValue(undefined),
}));

import { fetchTextWithPolicy } from "../../http";

const mockFetchText = vi.mocked(fetchTextWithPolicy);

describe("pbocAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct name", () => {
    expect(pbocAdapter.name).toBe("pboc");
  });

  it("parses USD/CNY rate from valid HTML fixture", async () => {
    mockFetchText.mockResolvedValueOnce(loadFixture("pboc-ok.html"));

    const ctx = { sourceName: "pboc-test" };
    const results = await pbocAdapter.fetch(ctx);

    expect(results).toHaveLength(1);
    const sample = results[0]!;
    expect(sample.metricKey).toBe("fx_usdcny");
    expect(sample.value).toBeCloseTo(7.2345);
    expect(sample.value).not.toBeNull();
    expect(typeof sample.rawText).toBe("string");
    expect(sample.rawText.length).toBeGreaterThan(0);
    // rawText must be stripped of HTML and ≤2000 code points
    expect(sample.rawText).not.toContain("<");
    expect(Array.from(sample.rawText).length).toBeLessThanOrEqual(2000);
    expect(sample.observedAt).toBeInstanceOf(Date);
  });

  it("returns value=null and preserves rawText when HTML has no rate data", async () => {
    mockFetchText.mockResolvedValueOnce(loadFixture("pboc-fail.html"));

    const ctx = { sourceName: "pboc-test" };
    const results = await pbocAdapter.fetch(ctx);

    expect(results).toHaveLength(1);
    const sample = results[0]!;
    expect(sample.metricKey).toBe("fx_usdcny");
    expect(sample.value).toBeNull();
    // rawText must still be preserved for audit
    expect(typeof sample.rawText).toBe("string");
    expect(sample.rawText.length).toBeGreaterThan(0);
    expect(sample.rawText).not.toContain("<");
  });

  it("returns [] when fetchTextWithPolicy throws", async () => {
    mockFetchText.mockRejectedValueOnce(new Error("network error"));

    const ctx = { sourceName: "pboc-test" };
    const results = await pbocAdapter.fetch(ctx);

    expect(results).toEqual([]);
  });

  it("respects endpoint override from sourceConfig", async () => {
    mockFetchText.mockResolvedValueOnce(loadFixture("pboc-ok.html"));

    const ctx = {
      sourceName: "pboc-test",
      sourceConfig: { endpoint: "https://custom.endpoint/pboc" },
    };
    await pbocAdapter.fetch(ctx);

    expect(mockFetchText).toHaveBeenCalledWith(
      "https://custom.endpoint/pboc",
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
  });

  it("rawText is truncated to ≤2000 Unicode code points for very long pages", async () => {
    // Build a page with >2000 chars of content
    const longContent = "美元汇率数据".repeat(500);
    const longHtml = `<html><body><table><tr><td>美元(USD)</td><td class="rate">7.1234</td></tr></table><p>${longContent}</p></body></html>`;
    mockFetchText.mockResolvedValueOnce(longHtml);

    const ctx = { sourceName: "pboc-test" };
    const results = await pbocAdapter.fetch(ctx);

    expect(results).toHaveLength(1);
    const sample = results[0]!;
    expect(Array.from(sample.rawText).length).toBeLessThanOrEqual(2000);
  });
});
