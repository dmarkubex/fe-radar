import { describe, expect, it, vi } from "vitest";
import { SourceFetchError } from "@fe-radar/shared";
import { BrowserContextPool, fetchPlaywright } from "../playwright";
import type { BrowserContextLike, PageLike, RequestLike, RouteLike } from "../playwright";
import type { ProxyEndpoint } from "../../lib/proxy-pool";

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

/** Minimal context mock; route is required (SSRF guard installs on context creation). */
function makeContext(newPage: () => Promise<PageLike>): BrowserContextLike {
  return {
    newPage,
    async close() {},
    async route() {}
  };
}

interface FakeDatedItem {
  title: string;
  url: string;
  /** textContent returned when the browser fn queries the configured dateSelector. */
  dateText?: string;
  /** attribute values for the date element (e.g. `<time datetime>` via dateAttribute). */
  dateAttrs?: Record<string, string>;
}

/**
 * Fake page whose nodes answer the dateSelector from $$eval's arg (Gate 0 date path).
 * Non-date selectors fall back to the title/link stand-in, same as makePage.
 */
function makePageWithDates(items: FakeDatedItem[]): PageLike {
  return {
    async goto() {},
    async waitForSelector() {},
    async $$eval<T, U>(_selector: string, fn: (nodes: Element[], arg: U) => T, arg: U): Promise<T> {
      const { dateSelector } = arg as { dateSelector?: string };
      const nodes = items.map((item) => ({
        textContent: item.title,
        href: item.url,
        matches: () => false,
        querySelector: (sel: string) => {
          if (dateSelector && sel === dateSelector) {
            return {
              textContent: item.dateText ?? "",
              getAttribute: (name: string) => item.dateAttrs?.[name] ?? null
            };
          }
          return { textContent: item.title, href: item.url };
        }
      })) as unknown as Element[];
      return fn(nodes, arg) as T;
    },
    async route() {},
    url: () => "https://example.com/",
    async close() {}
  } satisfies PageLike;
}

function makeProxy(id: string, server: string): ProxyEndpoint {
  return { id, server, disabled: false, failCount: 0 };
}

describe("playwright fetcher", () => {
  it("extracts items via declarative selectors (no new Function / extractor string)", async () => {
    const capturedSelectors: string[] = [];
    const pool = new BrowserContextPool(async () => ({
      async newContext() {
        return makeContext(async () => {
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
        });
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
        return makeContext(async () => makePage([{ title: "A", url: "https://example.com/a" }]));
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
            },
            async route() {}
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
            },
            async route() {}
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

  // T15a 缺陷 3：池满后 round-robin 复用必须返回 slot 实际绑定的 UA/代理，
  // 不能悄悄用本次请求的新身份（否则 robots 与真实请求身份、proxy 打分均错位）。
  it("returns slot-bound userAgent/proxy on pool reuse, not the newly requested identity", async () => {
    vi.stubEnv("SSRF_GUARD_ENABLED", "false");
    try {
      const pool = new BrowserContextPool(async () => ({
        async newContext(options: { userAgent: string; proxy?: { server: string } }) {
          const boundUa = options.userAgent;
          return {
            async newPage() {
              return makePage([{ title: "ok", url: "https://example.com/a" }]);
            },
            async close() {},
            async route() {},
            // tag for identity of the context object itself
            boundUa
          } as BrowserContextLike & { boundUa: string };
        },
        async close() {}
      }));

      const proxyA = makeProxy("proxy-a", "http://127.0.0.1:8001");
      const proxyB = makeProxy("proxy-b", "http://127.0.0.1:8002");
      const proxyC = makeProxy("proxy-c", "http://127.0.0.1:8003");

      const first = await pool.acquire("ua-A", proxyA);
      const second = await pool.acquire("ua-B", proxyB);
      expect(first.userAgent).toBe("ua-A");
      expect(first.proxy?.id).toBe("proxy-a");
      expect(second.userAgent).toBe("ua-B");
      expect(second.proxy?.id).toBe("proxy-b");

      // Pool full (MAX_CONTEXTS=2): third acquire round-robins to slot 0.
      const third = await pool.acquire("ua-C", proxyC);
      expect(third.userAgent).toBe("ua-A");
      expect(third.proxy?.id).toBe("proxy-a");
      expect(third.proxy).toBe(proxyA);
      expect(third.context).toBe(first.context);
      // Must NOT adopt the newly requested identity.
      expect(third.userAgent).not.toBe("ua-C");
      expect(third.proxy?.id).not.toBe("proxy-c");

      const fourth = await pool.acquire("ua-D", makeProxy("proxy-d", "http://127.0.0.1:8004"));
      expect(fourth.userAgent).toBe("ua-B");
      expect(fourth.proxy?.id).toBe("proxy-b");
      expect(fourth.context).toBe(second.context);
    } finally {
      vi.stubEnv("SSRF_GUARD_ENABLED", "false");
    }
  });

  // T16：池满 round-robin 必须跳过 proxy.disabled=true 的 slot；全部禁用时就地重建并重装 SSRF 守卫。
  // 失败链：T15a 修正打分对象后，disabled 能正确落位，但 acquire 从未检查 disabled → 永久复用坏代理。
  it("T16: skips disabled-proxy slots on pool reuse; rebuilds when all slots disabled", async () => {
    vi.stubEnv("SSRF_GUARD_ENABLED", "true");
    try {
      let contextRouteInstalls = 0;
      let contextsCreated = 0;
      const pool = new BrowserContextPool(async () => ({
        async newContext(options: { userAgent: string; proxy?: { server: string } }) {
          contextsCreated += 1;
          const boundUa = options.userAgent;
          return {
            async newPage() {
              return makePage([{ title: "ok", url: "https://example.com/a" }]);
            },
            async close() {},
            async route() {
              contextRouteInstalls += 1;
            },
            boundUa
          } as BrowserContextLike & { boundUa: string };
        },
        async close() {}
      }));

      const proxyA = makeProxy("proxy-a", "http://127.0.0.1:8001");
      const proxyB = makeProxy("proxy-b", "http://127.0.0.1:8002");
      const proxyC = makeProxy("proxy-c", "http://127.0.0.1:8003");

      const first = await pool.acquire("ua-A", proxyA);
      const second = await pool.acquire("ua-B", proxyB);
      expect(contextsCreated).toBe(2);
      expect(contextRouteInstalls).toBe(2);

      // Simulate proxyPool.release(P1, false) hitting failThreshold.
      proxyA.disabled = true;

      // Pool full; RR would land on slot 0 (bound to disabled proxyA).
      // Healthy path: must skip slot 0 and return slot 1 (proxyB), not proxyA or silent proxyC.
      const third = await pool.acquire("ua-C", proxyC);
      expect(third.proxy?.id).toBe("proxy-b");
      expect(third.proxy).toBe(proxyB);
      expect(third.proxy?.disabled).toBe(false);
      expect(third.userAgent).toBe("ua-B");
      expect(third.context).toBe(second.context);
      // Must NOT hand back the disabled slot identity (pre-fix failure mode).
      expect(third.proxy?.id).not.toBe("proxy-a");
      expect(third.proxy?.disabled).not.toBe(true);
      // No rebuild yet — healthy slot still available.
      expect(contextsCreated).toBe(2);
      expect(contextRouteInstalls).toBe(2);

      // Both bound proxies disabled → rebuild RR slot with requested healthy proxy + reinstall guard.
      proxyB.disabled = true;
      const fourth = await pool.acquire("ua-D", proxyC);
      expect(fourth.proxy?.id).toBe("proxy-c");
      expect(fourth.proxy).toBe(proxyC);
      expect(fourth.userAgent).toBe("ua-D");
      expect(fourth.proxy?.disabled).toBe(false);
      // New context on same browser slot → another newContext + guard install.
      expect(contextsCreated).toBe(3);
      expect(contextRouteInstalls).toBe(3);
      // Rebuilt context is a new object (old context was closed).
      expect(fourth.context).not.toBe(first.context);
      expect(fourth.context).not.toBe(second.context);
    } finally {
      vi.stubEnv("SSRF_GUARD_ENABLED", "false");
    }
  });

  // A-6: itemSelector 零匹配必须抛 FETCH_PLAYWRIGHT_EMPTY（对齐 html FETCH_HTML_EMPTY），
  // 不得返回 [] 让 handler 记为成功。
  it("throws FETCH_PLAYWRIGHT_EMPTY when itemSelector matches zero nodes", async () => {
    let evalCalled = 0;
    const pool = new BrowserContextPool(async () => ({
      async newContext() {
        return makeContext(async () => ({
          async goto() {},
          async waitForSelector() {},
          async $$eval<T, U>(_selector: string, fn: (nodes: Element[], arg: U) => T, arg: U): Promise<T> {
            evalCalled += 1;
            // Zero DOM matches — same shape as a live page where itemSelector drifted.
            return fn([] as unknown as Element[], arg) as T;
          },
          async route() {},
          url: () => "https://example.com/",
          async close() {}
        } satisfies PageLike));
      },
      async close() {}
    }));
    const robotsFetch = async () => new Response("");

    await expect(
      fetchPlaywright(
        { type: "playwright", listUrl: "https://example.com", waitFor: "body", itemSelector: ".article-item" },
        { sourceName: "test" },
        pool,
        robotsFetch as typeof fetch
      )
    ).rejects.toMatchObject({ code: "FETCH_PLAYWRIGHT_EMPTY" });

    await expect(
      fetchPlaywright(
        { type: "playwright", listUrl: "https://example.com", waitFor: "body", itemSelector: ".article-item" },
        { sourceName: "test" },
        pool,
        robotsFetch as typeof fetch
      )
    ).rejects.toBeInstanceOf(SourceFetchError);

    // $$eval ran (extraction attempted) but no successful item list was returned to caller.
    expect(evalCalled).toBeGreaterThanOrEqual(1);
  });

  it("still extracts when itemSelector matches nodes (no over-block)", async () => {
    const pool = new BrowserContextPool(async () => ({
      async newContext() {
        return makeContext(async () => makePage([{ title: "Hit", url: "https://example.com/hit" }]));
      },
      async close() {}
    }));
    const robotsFetch = async () => new Response("");
    const out = await fetchPlaywright(
      { type: "playwright", listUrl: "https://example.com", waitFor: "body", itemSelector: "article" },
      { sourceName: "test" },
      pool,
      robotsFetch as typeof fetch
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "Hit", url: "https://example.com/hit" });
  });

  // B-5 / A-6 收尾：itemSelector 命中但每条标题为空（站点改版后 titleSelector 失配）。
  // 修复前 extracted.length > 0 直接放行 → 静默产出垃圾条目、fetch.ts 仍记成功。
  it("throws FETCH_PLAYWRIGHT_EMPTY when itemSelector matches but all titles are empty", async () => {
    const pool = new BrowserContextPool(async () => ({
      async newContext() {
        return makeContext(async () =>
          // itemSelector hits 3 elements; every title is empty (titleSelector drifted).
          makePage([
            { title: "", url: "https://example.com/a" },
            { title: "   ", url: "https://example.com/b" },
            { title: "", url: "https://example.com/c" }
          ])
        );
      },
      async close() {}
    }));
    const robotsFetch = async () => new Response("");

    await expect(
      fetchPlaywright(
        { type: "playwright", listUrl: "https://example.com", waitFor: "body", itemSelector: "article" },
        { sourceName: "test" },
        pool,
        robotsFetch as typeof fetch
      )
    ).rejects.toMatchObject({ code: "FETCH_PLAYWRIGHT_EMPTY" });
  });

  it("throws FETCH_PLAYWRIGHT_EMPTY when all links resolve back to the list page URL", async () => {
    const pool = new BrowserContextPool(async () => ({
      async newContext() {
        return makeContext(async () =>
          // Titles valid, but every href is empty → new URL("", listUrl) === listUrl (fallback).
          makePage([
            { title: "Drifted link A", url: "" },
            { title: "Drifted link B", url: "" }
          ])
        );
      },
      async close() {}
    }));
    const robotsFetch = async () => new Response("");

    await expect(
      fetchPlaywright(
        { type: "playwright", listUrl: "https://example.com/news", waitFor: "body", itemSelector: "article" },
        { sourceName: "test" },
        pool,
        robotsFetch as typeof fetch
      )
    ).rejects.toMatchObject({ code: "FETCH_PLAYWRIGHT_EMPTY" });
  });

  it("filters out invalid items (empty title / fallback link) but keeps valid ones", async () => {
    const pool = new BrowserContextPool(async () => ({
      async newContext() {
        return makeContext(async () =>
          makePage([
            { title: "", url: "https://example.com/empty-title" }, // invalid: empty title
            { title: "Valid", url: "https://example.com/valid" }, // valid
            { title: "Empty link", url: "" }, // invalid: href → listUrl fallback
            { title: "Also valid", url: "https://example.com/also" } // valid
          ])
        );
      },
      async close() {}
    }));
    const robotsFetch = async () => new Response("");

    const out = await fetchPlaywright(
      { type: "playwright", listUrl: "https://example.com", waitFor: "body", itemSelector: "article" },
      { sourceName: "test" },
      pool,
      robotsFetch as typeof fetch
    );
    expect(out.map((r) => r.title)).toEqual(["Valid", "Also valid"]);
  });

  // T15a 缺陷 2：重定向后空 href 被浏览器解析为 finalUrl，若 listUrlNormalized 仍用
  // config.listUrl（重定向前）则回退判定不触发，垃圾条目放行。
  it("filters empty-href items against final redirected URL, not original listUrl", async () => {
    const listUrl = "https://x.com/start";
    const finalUrl = "https://x.com/final/";
    // Browser .href getter on empty href → current document URL = finalUrl (absolute).
    const browserResolvedEmptyHref = finalUrl;

    const pool = new BrowserContextPool(async () => ({
      async newContext() {
        return makeContext(async () =>
          makePage(
            [
              { title: "Garbage (empty href after redirect)", url: browserResolvedEmptyHref },
              { title: "Real article", url: "https://x.com/article/1" }
            ],
            { finalUrl }
          )
        );
      },
      async close() {}
    }));
    const robotsFetch = async () => new Response("");

    const out = await fetchPlaywright(
      { type: "playwright", listUrl, waitFor: "body", itemSelector: "article" },
      { sourceName: "test" },
      pool,
      robotsFetch as typeof fetch
    );

    // Garbage item filtered; only real article kept.
    expect(out.map((r) => r.title)).toEqual(["Real article"]);
    expect(out[0]?.url).toBe("https://x.com/article/1");
  });

  it("throws FETCH_PLAYWRIGHT_EMPTY when all items are empty-href fallbacks after redirect", async () => {
    const listUrl = "https://x.com/start";
    const finalUrl = "https://x.com/final/";

    const pool = new BrowserContextPool(async () => ({
      async newContext() {
        return makeContext(async () =>
          makePage(
            [
              { title: "Drift A", url: finalUrl },
              { title: "Drift B", url: finalUrl }
            ],
            { finalUrl }
          )
        );
      },
      async close() {}
    }));
    const robotsFetch = async () => new Response("");

    await expect(
      fetchPlaywright(
        { type: "playwright", listUrl, waitFor: "body", itemSelector: "article" },
        { sourceName: "test" },
        pool,
        robotsFetch as typeof fetch
      )
    ).rejects.toMatchObject({ code: "FETCH_PLAYWRIGHT_EMPTY" });
  });

  // Pure unit 回代：旧逻辑 (listUrl 基准) vs 新逻辑 (finalUrl 基准) 在同一输入上的结果。
  it("regression: old listUrl baseline would keep redirect empty-href junk; finalUrl filters it", () => {
    const listUrl = "https://x.com/start";
    const finalUrl = "https://x.com/final/";
    const itemUrl = finalUrl; // browser-resolved empty href

    // --- 旧逻辑（缺陷 2）---
    let oldNormalized: string;
    try {
      oldNormalized = new URL(listUrl).toString();
    } catch {
      oldNormalized = listUrl;
    }
    const oldResolved = new URL(itemUrl, listUrl).toString();
    const oldKeeps = oldResolved !== oldNormalized; // true = bug: junk kept

    // --- 新逻辑（修复后）---
    let newNormalized: string;
    try {
      newNormalized = new URL(finalUrl).toString();
    } catch {
      newNormalized = finalUrl;
    }
    const newResolved = new URL(itemUrl, finalUrl).toString();
    const newKeeps = newResolved !== newNormalized; // false = correctly filtered

    expect(oldKeeps).toBe(true); // documents pre-fix failure mode
    expect(newKeeps).toBe(false); // fix filters junk
    expect(oldNormalized).toBe("https://x.com/start");
    expect(newNormalized).toBe("https://x.com/final/");
  });

  // T-SEC-12 / T15a 缺陷 1：子资源守卫挂在 context.route（覆盖弹窗），不是 page.route。
  // 内网 abort / 公网 continue 行为不变；handler 从 context.route 捕获。
  it("aborts subresource requests to internal URLs while allowing public ones", async () => {
    vi.stubEnv("SSRF_GUARD_ENABLED", "true");
    try {
      let routeHandler: ((route: RouteLike, request: RequestLike) => Promise<void>) | undefined;
      let pageRouteCalled = 0;
      const pool = new BrowserContextPool(async () => ({
        async newContext() {
          return {
            async newPage() {
              return {
                async goto() {},
                async waitForSelector() {},
                async $$eval<T, U>(_selector: string, fn: (nodes: Element[], arg: U) => T, arg: U): Promise<T> {
                  // Non-empty so FETCH_PLAYWRIGHT_EMPTY does not short-circuit this guard test.
                  const nodes = [
                    {
                      textContent: "ok",
                      href: "https://93.184.216.34/a",
                      matches: () => false,
                      querySelector: () => ({ textContent: "ok", href: "https://93.184.216.34/a" })
                    }
                  ] as unknown as Element[];
                  return fn(nodes, arg) as T;
                },
                async route() {
                  // page.route must NOT be where the SSRF guard is installed (popup bypass).
                  pageRouteCalled += 1;
                },
                url: () => "https://93.184.216.34/list",
                async close() {}
              } satisfies PageLike;
            },
            async close() {},
            async route(_url: string, handler: (route: RouteLike, request: RequestLike) => Promise<void>) {
              routeHandler = handler;
            }
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
      // Guard installed on context, not page — page.route left unused by production path.
      expect(pageRouteCalled).toBe(0);

      const makeRoute = () => {
        const state = { aborted: false, continued: false };
        return {
          state,
          async abort() {
            state.aborted = true;
          },
          async continue() {
            state.continued = true;
          }
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

  // T15a 缺陷 1 补充：池复用时不得对同一 context 重复 install context.route。
  it("installs context.route SSRF guard only once per pooled context (no re-install on reuse)", async () => {
    vi.stubEnv("SSRF_GUARD_ENABLED", "true");
    try {
      let contextRouteInstalls = 0;
      const pool = new BrowserContextPool(async () => ({
        async newContext() {
          return {
            async newPage() {
              return makePage(
                [{ title: "ok", url: "https://93.184.216.34/a" }],
                { finalUrl: "https://93.184.216.34/list" }
              );
            },
            async close() {},
            async route() {
              contextRouteInstalls += 1;
            }
          };
        },
        async close() {}
      }));
      const robotsFetch = async () => new Response("");
      const cfg = {
        type: "playwright" as const,
        listUrl: "https://93.184.216.34/list",
        waitFor: "body",
        itemSelector: "a"
      };
      // Two contexts fill the pool (MAX=2) → 2 installs.
      await fetchPlaywright(cfg, { sourceName: "test" }, pool, robotsFetch as typeof fetch);
      await fetchPlaywright(cfg, { sourceName: "test" }, pool, robotsFetch as typeof fetch);
      expect(contextRouteInstalls).toBe(2);
      // Further fetches reuse slots — no additional route installs.
      await fetchPlaywright(cfg, { sourceName: "test" }, pool, robotsFetch as typeof fetch);
      await fetchPlaywright(cfg, { sourceName: "test" }, pool, robotsFetch as typeof fetch);
      await fetchPlaywright(cfg, { sourceName: "test" }, pool, robotsFetch as typeof fetch);
      expect(contextRouteInstalls).toBe(2);
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
          return makeContext(async () => ({
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
          } satisfies PageLike));
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

  // Gate 0：配 dateSelector 的源必须带真实发布时间（T-G0-04，对齐 html.ts 语义）。
  it("parses publishedAt from dateSelector textContent and dateAttribute (datetime)", async () => {
    const pool = new BrowserContextPool(async () => ({
      async newContext() {
        return makeContext(async () =>
          makePageWithDates([
            { title: "Chinese date", url: "https://example.com/a", dateText: "2026年8月10日" },
            {
              title: "Datetime attr",
              url: "https://example.com/b",
              dateAttrs: { datetime: "2026-08-12T09:30:00+08:00" }
            }
          ])
        );
      },
      async close() {}
    }));
    const robotsFetch = async () => new Response("");

    // First item: date from textContent (no dateAttribute).
    const outText = await fetchPlaywright(
      {
        type: "playwright",
        listUrl: "https://example.com",
        waitFor: "body",
        itemSelector: "article",
        dateSelector: ".date"
      },
      { sourceName: "test" },
      pool,
      robotsFetch as typeof fetch
    );
    // parsePublishedAt treats 无显式时区的国内日期为 Asia/Shanghai（UTC+8）。
    expect(outText[0]?.publishedAt).toEqual(new Date(Date.UTC(2026, 7, 10) - 8 * 3600e3));

    // Second fetch on a fresh pool: date from dateAttribute (`<time datetime>`).
    const pool2 = new BrowserContextPool(async () => ({
      async newContext() {
        return makeContext(async () =>
          makePageWithDates([
            {
              title: "Datetime attr",
              url: "https://example.com/b",
              dateAttrs: { datetime: "2026-08-12T09:30:00+08:00" }
            }
          ])
        );
      },
      async close() {}
    }));
    const outAttr = await fetchPlaywright(
      {
        type: "playwright",
        listUrl: "https://example.com",
        waitFor: "body",
        itemSelector: "article",
        dateSelector: "time",
        dateAttribute: "datetime"
      },
      { sourceName: "test" },
      pool2,
      robotsFetch as typeof fetch
    );
    expect(outAttr[0]?.publishedAt).toEqual(new Date("2026-08-12T09:30:00+08:00"));
  });

  // Gate 0：配了 dateSelector 但日期解析失败 → 条目丢弃（防 selector 漂移静默产出垃圾），
  // 不允许回退抓取时间冒充发布时间。
  it("drops items whose dateSelector text fails to parse when dateSelector is configured", async () => {
    const pool = new BrowserContextPool(async () => ({
      async newContext() {
        return makeContext(async () =>
          makePageWithDates([
            { title: "Valid date", url: "https://example.com/a", dateText: "2026-08-10" },
            { title: "Drifted selector", url: "https://example.com/b", dateText: "加载中…" },
            { title: "Missing date node", url: "https://example.com/c" } // dateText undefined → ""
          ])
        );
      },
      async close() {}
    }));
    const robotsFetch = async () => new Response("");

    const out = await fetchPlaywright(
      {
        type: "playwright",
        listUrl: "https://example.com",
        waitFor: "body",
        itemSelector: "article",
        dateSelector: ".date"
      },
      { sourceName: "test" },
      pool,
      robotsFetch as typeof fetch
    );
    expect(out.map((r) => r.title)).toEqual(["Valid date"]);
    expect(out[0]?.publishedAt).toEqual(new Date(Date.UTC(2026, 7, 10) - 8 * 3600e3));
  });

  // Gate 0：配了 dateSelector 且全部日期解析失败 → FETCH_PLAYWRIGHT_EMPTY。
  // 修复前 filter 后返回 []，fetch.ts 记成功并清零 fail_count，选择器漂移被伪装成健康。
  it("throws FETCH_PLAYWRIGHT_EMPTY when dateSelector is set and every date fails to parse", async () => {
    const pool = new BrowserContextPool(async () => ({
      async newContext() {
        return makeContext(async () =>
          makePageWithDates([
            { title: "Drifted A", url: "https://example.com/a", dateText: "加载中…" },
            { title: "Drifted B", url: "https://example.com/b", dateText: "刚刚" },
            { title: "Missing date node", url: "https://example.com/c" }
          ])
        );
      },
      async close() {}
    }));
    const robotsFetch = async () => new Response("");

    await expect(
      fetchPlaywright(
        {
          type: "playwright",
          listUrl: "https://example.com",
          waitFor: "body",
          itemSelector: "article",
          dateSelector: ".date"
        },
        { sourceName: "test" },
        pool,
        robotsFetch as typeof fetch
      )
    ).rejects.toMatchObject({
      code: "FETCH_PLAYWRIGHT_EMPTY",
      message: "Playwright dateSelector dates all failed to parse"
    });

    await expect(
      fetchPlaywright(
        {
          type: "playwright",
          listUrl: "https://example.com",
          waitFor: "body",
          itemSelector: "article",
          dateSelector: ".date"
        },
        { sourceName: "test" },
        pool,
        robotsFetch as typeof fetch
      )
    ).rejects.toBeInstanceOf(SourceFetchError);
  });

  // 兼容存量 playwright 源（如北极星系）：未配 dateSelector 时保持抓取时间兜底不变。
  it("keeps fetch-time fallback when dateSelector is not configured", async () => {
    const pool = new BrowserContextPool(async () => ({
      async newContext() {
        return makeContext(async () => makePage([{ title: "Legacy", url: "https://example.com/a" }]));
      },
      async close() {}
    }));
    const robotsFetch = async () => new Response("");

    const before = Date.now();
    const out = await fetchPlaywright(
      { type: "playwright", listUrl: "https://example.com", waitFor: "body", itemSelector: "article" },
      { sourceName: "test" },
      pool,
      robotsFetch as typeof fetch
    );
    const after = Date.now();

    expect(out).toHaveLength(1);
    const published = out[0]?.publishedAt.getTime();
    expect(published).toBeGreaterThanOrEqual(before);
    expect(published).toBeLessThanOrEqual(after);
  });
});
