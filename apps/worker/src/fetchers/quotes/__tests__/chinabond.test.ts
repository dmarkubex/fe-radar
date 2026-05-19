import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { chinabondAdapter } from "../chinabond";

const FIXTURES = join(__dirname, "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

vi.mock("../../http", () => ({
  fetchTextWithPolicy: vi.fn(),
}));

vi.mock("../../../lib/robots", () => ({
  assertRobotsAllowed: vi.fn().mockResolvedValue(undefined),
}));

import { fetchTextWithPolicy } from "../../http";

const mockFetchText = vi.mocked(fetchTextWithPolicy);

describe("chinabondAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct name", () => {
    expect(chinabondAdapter.name).toBe("chinabond");
  });

  it("parses 10Y CNY bond yield from valid HTML fixture", async () => {
    mockFetchText.mockResolvedValueOnce(loadFixture("chinabond-ok.html"));

    const ctx = { sourceName: "chinabond-test" };
    const results = await chinabondAdapter.fetch(ctx);

    expect(results).toHaveLength(1);
    const sample = results[0]!;
    expect(sample.metricKey).toBe("cny_10y_yield");
    expect(sample.value).toBeCloseTo(2.345);
    expect(sample.value).not.toBeNull();
    expect(typeof sample.rawText).toBe("string");
    expect(sample.rawText.length).toBeGreaterThan(0);
    // rawText must be stripped of HTML and ≤2000 code points
    expect(sample.rawText).not.toContain("<");
    expect(Array.from(sample.rawText).length).toBeLessThanOrEqual(2000);
    expect(sample.observedAt).toBeInstanceOf(Date);
  });

  it("returns value=null and preserves rawText when HTML has no yield data", async () => {
    mockFetchText.mockResolvedValueOnce(loadFixture("chinabond-fail.html"));

    const ctx = { sourceName: "chinabond-test" };
    const results = await chinabondAdapter.fetch(ctx);

    expect(results).toHaveLength(1);
    const sample = results[0]!;
    expect(sample.metricKey).toBe("cny_10y_yield");
    expect(sample.value).toBeNull();
    // rawText must still be preserved for audit
    expect(typeof sample.rawText).toBe("string");
    expect(sample.rawText.length).toBeGreaterThan(0);
    expect(sample.rawText).not.toContain("<");
  });

  it("returns [] when fetchTextWithPolicy throws", async () => {
    mockFetchText.mockRejectedValueOnce(new Error("connection refused"));

    const ctx = { sourceName: "chinabond-test" };
    const results = await chinabondAdapter.fetch(ctx);

    expect(results).toEqual([]);
  });

  it("respects endpoint override from sourceConfig", async () => {
    mockFetchText.mockResolvedValueOnce(loadFixture("chinabond-ok.html"));

    const ctx = {
      sourceName: "chinabond-test",
      sourceConfig: { endpoint: "https://custom.endpoint/chinabond" },
    };
    await chinabondAdapter.fetch(ctx);

    expect(mockFetchText).toHaveBeenCalledWith(
      "https://custom.endpoint/chinabond",
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
  });

  it("rawText is truncated to ≤2000 Unicode code points for very long pages", async () => {
    const longContent = "国债收益率数据".repeat(500);
    const longHtml = `<html><body><div id="yield-table"><table><tr><td>10年</td><td id="yield-10y">2.3450</td><td>2026-05-20</td></tr></table></div><p>${longContent}</p></body></html>`;
    mockFetchText.mockResolvedValueOnce(longHtml);

    const ctx = { sourceName: "chinabond-test" };
    const results = await chinabondAdapter.fetch(ctx);

    expect(results).toHaveLength(1);
    const sample = results[0]!;
    expect(Array.from(sample.rawText).length).toBeLessThanOrEqual(2000);
  });
});
