import { describe, expect, it, vi } from "vitest";
import { SourceFetchError } from "@fe-radar/shared";
import { BrowserContextPool, fetchPlaywright } from "../playwright";
import type { PageLike, RequestLike, RouteLike } from "../playwright";

/** Builds a fake page whose $$eval returns the given items (declarative selector path, T-SEC-03). */
function makePage(
  items: Array<{ title: string; url: string }>,
  opts?: { finalUrl?: string }
): PageLike {
  const finalUrl = opts?.finalUrl ?? "https://example.com/";
  return {
    async goto() {},
    async waitForSelector() {},
    async $$eval<T, U>(_selector: string, fn: (nodes: Element[], arg: U) => T, arg: U): Promise<T> {
      // Fake DOM nodes: each carries textContent + href via a minimal stand-in.
      const nodes = items.map((item) => ({
        textContent: item.title,
        href: item.url,
        matches: () => false,
        querySelector: () => ({ textContent: item.title, href: item.url })
      })) as unknown as Element[];
      return fn(nodes, arg) as T;
    },
    async route() {},
    url: () => finalUrl,
    async close() {}
  } satisfies PageLike;
}

describe("playwright fetcher", () => {
  it("extracts items via declarative selectors (no new Function / extractor string)", async () => {
    const capturedSelectors: string[] = [];
    const pool = new BrowserContextPool(async () => ({
      async newContext() {
        return {
          async newPage() {
            const page = makePage([
              { title: "A", url: "https://example.com/a" },
              { title: "B", url: "https://example.com/b" }
            ]);
            const origEval = page.$$eval.bind(page) as PageLike["$$eval"];
            // Capture the selector passed in (asserts the declarative field flows through).
            return {
              ...page,
              $$eval<T, U>(selector: string, fn: (nodes: Element[], arg: U) => T, arg: U): Promise<T> {
                capturedSelectors.push(selector);
                return origEval<T, U>(selector, fn, arg);
              }
            } as PageLike;
          },
          async close() {}
        };
      },
      async close() {}
    }));
    const robotsFetch = async () => new Response("");
    const out = await fetchPlaywright(
      { type: "playwright", listUrl: "https://example.com", waitFor: "body", itemSelector: "article a", limit: 5 },
      { sourceName: "test" },
      pool,
      robotsFetch as typeof fetch
    );
    expect(out.map((r) => r.title)).toEqual(["A", "B"]);
    expect(capturedSelectors).toEqual(["article a"]);
  });

  it("reuses browser context pool across repeated fetches", async () => {
    let contexts = 0;
    const pool = new BrowserContextPool(async () => ({
      async newContext() {
        contexts += 1;
        return {
          async newPage() {
            return makePage([{ title: "A", url: "https://example.com/a" }]);
          },
          async close() {}
        };
      },
      async close() {}
    }));
    const robotsFetch = async () => new Response("");
    for (let i = 0; i < 10; i += 1) {
      await fetchPlaywright(
        { type: "playwright", listUrl: "https://example.com", waitFor: "body", itemSelector: "a" },
        { sourceName: "test" },
        pool,
        robotsFetch as typeof fetch
      );
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
              return makePage([]);
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
              return makePage([]);
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

  // T-SEC-12: 子资源守卫 —— listUrl 前置校验只覆盖导航入口，页面加载的 script/img/XHR
  // 必须逐请求跑 SSRF 守卫，内网目的地 route.abort()。用 IP 字面量避免测试环境 DNS 依赖。
  it("aborts subresource requests to internal URLs while allowing public ones", async () => {
    vi.stubEnv("SSRF_GUARD_ENABLED", "true");
    try {
      let routeHandler: ((route: RouteLike, request: RequestLike) => Promise<void>) | undefined;
      const pool = new BrowserContextPool(async () => ({
        async newContext() {
          return {
            async newPage() {
              return {
                async goto() {},
                async waitForSelector() {},
                async $$eval<T, U>(_selector: string, fn: (nodes: Element[], arg: U) => T, arg: U): Promise<T> {
                  return fn([] as unknown as Element[], arg) as T;
                },
                async route(_url: string, handler: (route: RouteLike, request: RequestLike) => Promise<void>) {
                  routeHandler = handler;
                },
                url: () => "https://93.184.216.34/list",
                async close() {}
              } satisfies PageLike;
            },
            async close() {}
          };
        },
        async close() {}
      }));
      const robotsFetch = async () => new Response("");
      await fetchPlaywright(
        { type: "playwright", listUrl: "https://93.184.216.34/list", waitFor: "body", itemSelector: "a" },
        { sourceName: "test" },
        pool,
        robotsFetch as typeof fetch
      );

      expect(routeHandler).toBeDefined();
      const makeRoute = () => {
        const state = { aborted: false, continued: false };
        return {
          state,
          async abort() { state.aborted = true; },
          async continue() { state.continued = true; }
        };
      };

      const internal = makeRoute();
      await routeHandler!(internal, { url: () => "http://127.0.0.1:8080/admin" });
      expect(internal.state.aborted).toBe(true);
      expect(internal.state.continued).toBe(false);

      const metadata = makeRoute();
      await routeHandler!(metadata, { url: () => "http://169.254.169.254/latest/meta-data" });
      expect(metadata.state.aborted).toBe(true);

      const publicAsset = makeRoute();
      await routeHandler!(publicAsset, { url: () => "https://93.184.216.34/app.js" });
      expect(publicAsset.state.continued).toBe(true);
      expect(publicAsset.state.aborted).toBe(false);
    } finally {
      vi.stubEnv("SSRF_GUARD_ENABLED", "false");
    }
  });

  // S5 / C2: goto 后 page.url() 落内网 → SourceFetchError，且不执行 $$eval
  it("throws SourceFetchError when final page.url() is internal and does not $$eval", async () => {
    vi.stubEnv("SSRF_GUARD_ENABLED", "true");
    try {
      let evalCalled = 0;
      const pool = new BrowserContextPool(async () => ({
        async newContext() {
          return {
            async newPage() {
              return {
                async goto() {},
                async waitForSelector() {
                  throw new Error("waitForSelector must not run after final-URL block");
                },
                async $$eval() {
                  evalCalled += 1;
                  throw new Error("$$eval must not run after final-URL block");
                },
                async route() {},
                url: () => "http://169.254.169.254/latest/meta-data",
                async close() {}
              } satisfies PageLike;
            },
            async close() {}
          };
        },
        async close() {}
      }));
      const robotsFetch = async () => new Response("");

      await expect(
        fetchPlaywright(
          {
            type: "playwright",
            listUrl: "https://93.184.216.34/list",
            waitFor: "body",
            itemSelector: "a"
          },
          { sourceName: "test" },
          pool,
          robotsFetch as typeof fetch
        )
      ).rejects.toBeInstanceOf(SourceFetchError);

      await expect(
        fetchPlaywright(
          {
            type: "playwright",
            listUrl: "https://93.184.216.34/list",
            waitFor: "body",
            itemSelector: "a"
          },
          { sourceName: "test" },
          pool,
          robotsFetch as typeof fetch
        )
      ).rejects.toMatchObject({ code: "FETCH_SSRF_BLOCKED" });

      expect(evalCalled).toBe(0);
    } finally {
      vi.stubEnv("SSRF_GUARD_ENABLED", "false");
    }
  });
});
