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

  it("closes both browser and context on pool.close()", async () => {
    const closedContexts: number[] = [];
    const closedBrowsers: number[] = [];
    let browserId = 0;

    const pool = new BrowserContextPool(async () => {
      const id = browserId;
      browserId += 1;

      return {
        async newContext() {
          return {
            async newPage() {
              return {
                async goto() {},
                async waitForSelector() {},
                async evaluate() {
                  return [];
                },
                async close() {}
              };
            },
            async close() {
              closedContexts.push(id);
            }
          };
        },
        async close() {
          closedBrowsers.push(id);
        }
      };
    });

    await pool.acquire("ua-1");
    await pool.acquire("ua-2");

    await pool.close();

    expect(closedContexts.sort((left, right) => left - right)).toEqual([0, 1]);
    expect(closedBrowsers.sort((left, right) => left - right)).toEqual([0, 1]);
  });

  it("closes browsers even if context.close fails", async () => {
    const closedBrowsers: number[] = [];
    let browserId = 0;

    const pool = new BrowserContextPool(async () => {
      const id = browserId;
      browserId += 1;

      return {
        async newContext() {
          return {
            async newPage() {
              return {
                async goto() {},
                async waitForSelector() {},
                async evaluate() {
                  return [];
                },
                async close() {}
              };
            },
            async close() {
              throw new Error("context close failed");
            }
          };
        },
        async close() {
          closedBrowsers.push(id);
        }
      };
    });

    await pool.acquire("ua-1");
    await pool.acquire("ua-2");

    await pool.close();

    expect(closedBrowsers.sort((left, right) => left - right)).toEqual([0, 1]);
  });
});
