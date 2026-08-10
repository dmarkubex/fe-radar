import { createLogger, SourceFetchError } from "@fe-radar/shared";
import { assertPublicFetchUrl } from "@fe-radar/core";
import { acquireUserAgent } from "../lib/ua-pool";
import { proxyPool } from "../lib/proxy-pool";
import { assertRobotsAllowed } from "../lib/robots";
import type { FetchContext, PlaywrightSourceConfig, StandardItem } from "./types";

const logger = createLogger({ service: "fetch-playwright" });

interface ExtractedItem {
  url: string;
  title: string;
  content?: string;
  publishedAt?: string;
}

interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface BrowserLike {
  newContext(options: { userAgent: string; proxy?: { server: string } }): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

export interface RouteLike {
  abort(): Promise<void>;
  continue(): Promise<void>;
}

export interface RequestLike {
  url(): string;
}

export interface PageLike {
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
  waitForSelector(selector: string, options: { timeout: number }): Promise<unknown>;
  $$eval<T, U>(selector: string, fn: (nodes: Element[], arg: U) => T, arg: U): Promise<T>;
  route(url: string, handler: (route: RouteLike, request: RequestLike) => Promise<void>): Promise<unknown>;
  /** 当前主框架 URL；goto 后用于复验最终落点（Chromium 内部消化 30x，route 拦不到）。 */
  url(): string;
  close(): Promise<void>;
}

const MAX_CONTEXTS = 2;

export class BrowserContextPool {
  private slots: { browser: BrowserLike; context: BrowserContextLike }[] = [];
  private cursor = 0;

  public constructor(private readonly browserFactory: () => Promise<BrowserLike>) {}

  public async acquire(userAgent: string, proxy?: { server: string }): Promise<BrowserContextLike> {
    if (this.slots.length < MAX_CONTEXTS) {
      const browser = await this.browserFactory();
      const context = await browser.newContext({ userAgent, proxy });
      this.slots.push({ browser, context });
      return context;
    }

    const slot = this.slots[this.cursor % this.slots.length];
    this.cursor += 1;
    if (!slot) {
      throw new SourceFetchError("FETCH_PLAYWRIGHT_POOL", "Browser context pool is empty");
    }
    return slot.context;
  }

  public async close(): Promise<void> {
    const slots = this.slots;
    this.slots = [];
    await Promise.allSettled(slots.map(async ({ context, browser }) => {
      try {
        await context.close();
      } finally {
        await browser.close();
      }
    }));
  }
}

export async function createPlaywrightPool(): Promise<BrowserContextPool> {
  const { chromium } = await import("playwright");
  return new BrowserContextPool(() => chromium.launch({ headless: true }));
}

export async function fetchPlaywright(
  config: PlaywrightSourceConfig,
  context: FetchContext,
  pool: BrowserContextPool,
  robotsFetch?: typeof fetch
): Promise<StandardItem[]> {
  // T-SEC-12: SSRF 守卫在浏览器导航前拦截（与 http.ts 同一守卫，防 listUrl 指向内网/metadata）。
  if (process.env.SSRF_GUARD_ENABLED !== "false") {
    const guard = await assertPublicFetchUrl(config.listUrl);
    if (!guard.allowed) {
      throw new SourceFetchError("FETCH_SSRF_BLOCKED", `Playwright listUrl blocked by SSRF guard: ${guard.reason}`, { url: config.listUrl, reason: guard.reason });
    }
  }
  const userAgent = acquireUserAgent(context.useRealUa);
  await assertRobotsAllowed(config.listUrl, userAgent, robotsFetch ?? fetch);
  const proxy = proxyPool.acquire();
  const browserContext = await pool.acquire(userAgent, proxy?.server ? { server: proxy.server } : undefined);
  const page = await browserContext.newPage();

  if (process.env.SSRF_GUARD_ENABLED !== "false") {
    await installSubresourceGuard(page);
  }

  try {
    await page.goto(config.listUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    // S5 / C2: Chromium 网络栈内部消化 30x，page.route 对重定向产生的主框架新请求不触发
    //（playwright#3993）。goto 返回后对最终落点重跑守卫；不符即抛，禁止 $$eval 抽取内网页。
    //
    // 残余风险（应用层无法闭环）：Chromium 自建连、自解析 DNS，assertPublicFetchUrl 在 goto
    // 之后看到的是最终 URL 字符串，但无法钉住浏览器 lookup 的 IP。DNS rebinding
    //（TTL=0 先公网后内网）仍可能让浏览器实际连上内网而 page.url() 仍显示公网 hostname。
    // 真正闭环需要出口 ACL 或受控代理（强制所有出站经可审计的 HTTP 代理）。
    if (process.env.SSRF_GUARD_ENABLED !== "false") {
      const finalUrl = page.url();
      const finalGuard = await assertPublicFetchUrl(finalUrl);
      if (!finalGuard.allowed) {
        throw new SourceFetchError(
          "FETCH_SSRF_BLOCKED",
          `Playwright final URL after navigation blocked by SSRF guard: ${finalGuard.reason}`,
          { url: finalUrl, reason: finalGuard.reason, listUrl: config.listUrl }
        );
      }
    }
    await page.waitForSelector(config.waitFor, { timeout: 30000 });
    const extracted = await extractItems(page, config);
    proxyPool.release(proxy, true);
    return extracted.map((item) => ({
      title: item.title.trim(),
      url: new URL(item.url, config.listUrl).toString(),
      content: (item.content ?? item.title).trim(),
      publishedAt: item.publishedAt ? new Date(item.publishedAt) : new Date()
    }));
  } catch (error) {
    proxyPool.release(proxy, false);
    throw error;
  } finally {
    await page.close();
  }
}

/** 子资源守卫的 hostname 拒绝判定缓存 TTL（页面加载生命周期短，60s 足够）。 */
const SUBRESOURCE_GUARD_TTL_MS = 60 * 1000;

/**
 * T-SEC-12: 子资源守卫。listUrl 的前置校验只覆盖导航入口；页面 302 跳转、加载的
 * script / img / XHR 都可能触达内网 / metadata。page.route 全通配拦截每个请求跑
 * assertPublicFetchUrl，拒绝即 abort（只断该子请求，不 fail 整个页面）。
 *
 * 缓存策略（评审 residual 修正）：**只缓存 deny，不缓存 allow**。正缓存 allowed=true
 * 会被 TTL=0 的 DNS rebinding 利用（先解析公网缓存放行、后换内网 IP 直接命中缓存）；
 * deny 缓存无此利用面（攻击者无法靠「曾被拒」获利），且拒绝多为重复的 tracker/广告域，
 * 缓存收益集中在 deny 侧。allow 每次走完整守卫，dns.lookup 有系统缓存兜底，成本可接受。
 * 非 http(s) / 带凭据 / 非标端口的 URL 同样不缓存、每次走完整守卫。
 *
 * 残余（与 goto 后 final-URL 复验相同）：Chromium 自解析 DNS，应用层 route 守卫
 * 按 URL hostname 判定，无法钉住实际连接 IP；DNS rebinding 需出口 ACL 闭环。
 */
async function installSubresourceGuard(page: PageLike): Promise<void> {
  const denyCache = new Map<string, number>(); // hostname → expiresAt

  await page.route("**/*", async (route, request) => {
    const url = request.url();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      // 无法解析的 URL fail-closed。
      await route.abort();
      return;
    }

    const cacheable =
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" &&
      parsed.password === "" &&
      (parsed.port === "" || parsed.port === "80" || parsed.port === "443");
    const key = parsed.hostname.toLowerCase();

    if (cacheable) {
      const denyExpires = denyCache.get(key);
      if (denyExpires !== undefined && denyExpires > Date.now()) {
        await route.abort();
        return;
      }
    }

    const guard = await assertPublicFetchUrl(url);
    if (!guard.allowed) {
      if (cacheable) {
        denyCache.set(key, Date.now() + SUBRESOURCE_GUARD_TTL_MS);
      }
      logger.warn({ url, reason: guard.reason }, "playwright subresource blocked by SSRF guard");
      await route.abort();
      return;
    }
    await route.continue();
  });
}

/**
 * T-SEC-03: 用固定浏览器侧函数 + 声明式 CSS 选择器抽取列表项，**不接受任何编辑员字符串作为代码**。
 * 替代旧的 compileExtractor(new Function) —— 后者是 editor→worker RCE。
 *
 * 浏览器侧函数体是常量：对 itemSelector 选中的节点，按 titleSelector/linkSelector 取文本与 href，
 * 截断到 limit。选择器字符串本身作为数据传给 $$eval，浏览器仅作 DOM 查询，不会执行它们。
 */
async function extractItems(page: PageLike, config: PlaywrightSourceConfig): Promise<ExtractedItem[]> {
  const itemSelector = config.itemSelector;
  const titleSelector = config.titleSelector ?? "a";
  const linkSelector = config.linkSelector ?? "a";
  const limit = Math.min(Math.max(config.limit ?? 20, 1), 50);

  return page.$$eval<ExtractedItem[], { titleSelector: string; linkSelector: string; limit: number }>(
    itemSelector,
    (nodes, { titleSelector, linkSelector, limit }) =>
      nodes.slice(0, limit).map((node) => {
        const titleEl = node.matches(titleSelector) ? node : node.querySelector(titleSelector);
        const linkEl = node.matches(linkSelector) ? node : node.querySelector(linkSelector);
        const title = titleEl?.textContent ?? "";
        const url = (linkEl as HTMLAnchorElement | null)?.href ?? "";
        return { title: title.trim(), url };
      }),
    { titleSelector, linkSelector, limit }
  );
}
