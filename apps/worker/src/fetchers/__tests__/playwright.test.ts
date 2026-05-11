import { describe, expect, it } from "vitest";
import { BrowserContextPool, compileExtractor, fetchPlaywright } from "../playwright";

describe("playwright fetcher", () => {
  it("rejects unsafe extractor globals", () => {
    expect(() => compileExtractor("() => eval('1')")).toThrow("blocked globals");
  });

  it("reuses browser context pool across repeated fetches", async () => {
    let contexts = 0;
    const pool = new BrowserContextPool(async () => ({
      async newContext() {
        contexts += 1;
        return {
          async newPage() {
            return {
              async goto() {},
              async waitForSelector() {},
              async evaluate() {
                return [{ title: "A", url: "https://example.com/a" }];
              },
              async close() {}
            };
          },
          async close() {}
        };
      },
      async close() {}
    }));
    const robotsFetch = async () => new Response("");
    for (let i = 0; i < 10; i += 1) {
      await fetchPlaywright({ type: "playwright", listUrl: "https://example.com", waitFor: "body", extractor: "() => [{ title: 'A', url: '/a' }]" }, { sourceName: "test" }, pool, robotsFetch as typeof fetch);
    }
    expect(contexts).toBeLessThanOrEqual(2);
  });
});
