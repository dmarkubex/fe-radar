import { createLogger, SourceFetchError } from "@fe-radar/shared";
import { assertPublicFetchUrl, waitHostGapForUrl } from "@fe-radar/core";
import { acquireUserAgent } from "../lib/ua-pool";
import { proxyPool, type ProxyEndpoint } from "../lib/proxy-pool";
import { assertRobotsAllowed } from "../lib/robots";
import type { FetchContext, PlaywrightSourceConfig, StandardItem } from "./types";
import { parsePublishedAt } from "./html";

const logger = createLogger({ service: "fetch-playwright" });

interface ExtractedItem {
  url: string;
  title: string;
  content?: string;
  publishedAt?: string;
}

export interface RouteLike {
  abort(): Promise<void>;
  continue(): Promise<void>;
}

export interface RequestLike {
  url(): string;
}

/** Context-level route surface (Playwright BrowserContext.route). */
export interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
  /**
   * Installs a route handler for every page in this context, including future
   * popups from window.open(). Prefer this over Page.route for SSRF guards.
   */
  route(url: string, handler: (route: RouteLike, request: RequestLike) => Promise<void>): Promise<unknown>;
}

interface BrowserLike {
  newContext(options: { userAgent: string; proxy?: { server: string } }): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

export interface PageLike {
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
  waitForSelector(selector: string, options: { timeout: number }): Promise<unknown>;
  $$eval<T, U>(selector: string, fn: (nodes: Element[], arg: U) => T, arg: U): Promise<T>;
  /** Optional page-level route (tests / legacy); production SSRF guard uses context.route. */
  route?(url: string, handler: (route: RouteLike, request: RequestLike) => Promise<void>): Promise<unknown>;
  /** 当前主框架 URL；goto 后用于复验最终落点（Chromium 内部消化 30x，route 拦不到）。 */
  url(): string;
  /**
   * T-CA-04（design §3.4.1）：页面 HTML。无 timeout 参（与 Playwright 真实签名一致）；
   * 全文路径的竞速由调用方 Promise.race 包一层，不在接口里加参数。
   */
  content(): Promise<string>;
  close(): Promise<void>;
}

/** Actual identity bound to a pooled BrowserContext (may differ from the request). */
export interface PooledBrowserContext {
  context: BrowserContextLike;
  userAgent: string;
  proxy?: ProxyEndpoint;
}

interface PoolSlot {
  browser: BrowserLike;
  context: BrowserContextLike;
  userAgent: string;
  proxy?: ProxyEndpoint;
}

const MAX_CONTEXTS = 2;

export class BrowserContextPool {
  private slots: PoolSlot[] = [];
  private cursor = 0;
  /**
   * T-CA-04（design §3.4.2 Playwright 池段）：in-flight slot 创建占位。
   * 并发 acquire 在池未满时共享同一次 factory 调用（第二个等第一个 launch 结束，
   * 不得并发双 launch）；launch reject → 该次 acquire 失败并清掉占位，
   * 允许下一次 acquire 重试。
   */
  private createInFlight: Promise<unknown> | null = null;

  public constructor(private readonly browserFactory: () => Promise<BrowserLike>) {}

  /**
   * Acquire a browser context. When the pool has capacity, creates a new context
   * bound to the requested userAgent/proxy. When full, round-robins an existing
   * slot and returns **that slot's bound identity** (not the requested one).
   *
   * T16: when full, skip slots whose bound proxy is `disabled === true`. Prefer the
   * RR-selected slot if healthy; otherwise any other healthy slot. If every slot's
   * proxy is disabled, rebuild the RR slot in place with the requested identity
   * (close old context, newContext on the same browser, reinstall SSRF guard).
   *
   * Callers must use the returned userAgent for robots checks and the returned
   * proxy for proxyPool.release scoring — never the pre-acquire request values.
   */
  public async acquire(userAgent: string, proxy?: ProxyEndpoint): Promise<PooledBrowserContext> {
    while (this.slots.length < MAX_CONTEXTS) {
      const inFlight = this.createInFlight;
      if (inFlight) {
        // 并发双 acquire：等待正在进行的 launch，结束后重新评估容量
        //（可能自行起下一次 flight，或转 RR 复用）。共享的 flight 失败则一并失败。
        await inFlight;
        continue;
      }
      const creating = this.createSlot(userAgent, proxy);
      this.createInFlight = creating;
      try {
        return await creating;
      } finally {
        this.createInFlight = null;
      }
    }

    const startIdx = this.cursor % this.slots.length;
    this.cursor += 1;

    // Prefer RR-selected, then remaining slots; skip proxies marked disabled by proxyPool.
    for (let offset = 0; offset < this.slots.length; offset += 1) {
      const slot = this.slots[(startIdx + offset) % this.slots.length];
      if (!slot) {
        continue;
      }
      if (slot.proxy?.disabled !== true) {
        return { context: slot.context, userAgent: slot.userAgent, proxy: slot.proxy };
      }
    }

    // All slots bind disabled proxies — rebuild the RR-selected slot with this request.
    const rebuildSlot = this.slots[startIdx] ?? this.slots[0];
    if (!rebuildSlot) {
      throw new SourceFetchError("FETCH_PLAYWRIGHT_POOL", "Browser context pool is empty");
    }
    try {
      await rebuildSlot.context.close();
    } catch {
      // Best-effort close; still replace context so we leave the disabled proxy behind.
    }
    const context = await rebuildSlot.browser.newContext({
      userAgent,
      proxy: proxy?.server ? { server: proxy.server } : undefined
    });
    // New context has no route handlers — must reinstall SSRF guard (T15a invariant).
    if (process.env.SSRF_GUARD_ENABLED !== "false") {
      await installSubresourceGuard(context);
    }
    rebuildSlot.context = context;
    rebuildSlot.userAgent = userAgent;
    rebuildSlot.proxy = proxy;
    return { context, userAgent, proxy };
  }

  private async createSlot(userAgent: string, proxy?: ProxyEndpoint): Promise<PooledBrowserContext> {
    const browser = await this.browserFactory();
    const context = await browser.newContext({
      userAgent,
      proxy: proxy?.server ? { server: proxy.server } : undefined
    });
    // SSRF subresource guard once per context creation — covers main page + future
    // popups (window.open). Do NOT re-install on pool reuse (duplicate handlers).
    if (process.env.SSRF_GUARD_ENABLED !== "false") {
      await installSubresourceGuard(context);
    }
    this.slots.push({ browser, context, userAgent, proxy });
    return { context, userAgent, proxy };
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

  // Requested identity is a hint for new slots only. After pool.acquire, use the
  // **actual** bound identity for robots + proxy scoring (pool reuse may differ).
  const requestedUserAgent = acquireUserAgent(context.useRealUa);
  const requestedProxy = proxyPool.acquire();
  const pooled = await pool.acquire(requestedUserAgent, requestedProxy);
  const { context: browserContext, userAgent, proxy } = pooled;

  await assertRobotsAllowed(config.listUrl, userAgent, robotsFetch ?? fetch);
  const page = await browserContext.newPage();

  try {
    // T-CA-04 / design §3.4.2 IN③：列表页 goto 前显式打一次闸。禁止做成「所有 goto 必打」
    // 的通用包装 —— 全文路径的闸由 §3.4.1 step 4 自己显式调用，不再重复。
    await waitHostGapForUrl(config.listUrl);
    await page.goto(config.listUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Always capture post-navigation URL (redirect landing). Used for SSRF recheck
    // and for extractItems list-page fallback detection — not gated on SSRF switch.
    const finalUrl = page.url();
    // S5 / C2: Chromium 网络栈内部消化 30x，page.route 对重定向产生的主框架新请求不触发
    //（playwright#3993）。goto 返回后对最终落点重跑守卫；不符即抛，禁止 $$eval 抽取内网页。
    //
    // 残余风险（应用层无法闭环）：Chromium 自建连、自解析 DNS，assertPublicFetchUrl 在 goto
    // 之后看到的是最终 URL 字符串，但无法钉住浏览器 lookup 的 IP。DNS rebinding
    //（TTL=0 先公网后内网）仍可能让浏览器实际连上内网而 page.url() 仍显示公网 hostname。
    // 真正闭环需要出口 ACL 或受控代理（强制所有出站经可审计的 HTTP 代理）。
    if (process.env.SSRF_GUARD_ENABLED !== "false") {
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
    const extracted = await extractItems(page, config, finalUrl);
    // Gate 0（对齐 html.ts）：配了 dateSelector 的源必须解析出真实发布时间，解析失败的
    // 条目丢弃（防选择器漂移静默产出以抓取时间冒充的垃圾时间线）；未配 dateSelector 的
    // 存量源保持抓取时间兜底不变。
    // 全部日期解析失败必须在 mark-success 之前抛错：否则 fetch.ts 把 [] 当「无新增」
    // 并 markSourceSuccess()，选择器漂移会被永久伪装成健康。抛错须在 release(true)
    // 之前，否则 catch 会再 release(false) 造成双重打分。
    const mapped = extracted
      .map((item) => ({
        title: item.title.trim(),
        url: new URL(item.url, finalUrl).toString(),
        content: (item.content ?? item.title).trim(),
        publishedAt: config.dateSelector ? parsePublishedAt(item.publishedAt) : new Date()
      }))
      .filter((item): item is StandardItem => item.publishedAt !== null);
    if (config.dateSelector && mapped.length === 0) {
      throw new SourceFetchError(
        "FETCH_PLAYWRIGHT_EMPTY",
        "Playwright dateSelector dates all failed to parse",
        {
          dateSelector: config.dateSelector,
          matched: extracted.length,
          valid: 0,
          reason: "all dateSelector dates failed to parse"
        }
      );
    }
    proxyPool.release(proxy, true);
    return mapped;
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
 * T-SEC-12 / T15a: 子资源守卫挂在 **BrowserContext.route**，覆盖该 context 下所有
 * 页面（含 window.open 产生的弹窗）。page.route 只保护装它的那一个 Page，弹窗是
 * 全新 Page 对象，会完全绕过 page 级守卫。
 *
 * 只在 context **创建时**调用一次（见 BrowserContextPool.acquire）；池复用不得重复
 * install，否则同一请求会命中多个 handler。
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
async function installSubresourceGuard(context: BrowserContextLike): Promise<void> {
  const denyCache = new Map<string, number>(); // hostname → expiresAt

  await context.route("**/*", async (route, request) => {
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
 *
 * @param finalUrl post-navigation document URL (after redirects). Used as the base for
 *   resolving item URLs and for "href fell back to list page" validity checks. Must not
 *   use config.listUrl here — empty href is resolved by the browser against the *current*
 *   document URL, which is finalUrl after a 30x, not the original listUrl.
 */
async function extractItems(
  page: PageLike,
  config: PlaywrightSourceConfig,
  finalUrl: string
): Promise<ExtractedItem[]> {
  const itemSelector = config.itemSelector;
  const titleSelector = config.titleSelector ?? "a";
  const linkSelector = config.linkSelector ?? "a";
  const dateSelector = config.dateSelector;
  const dateAttribute = config.dateAttribute;
  const limit = Math.min(Math.max(config.limit ?? 20, 1), 50);

  const extracted = await page.$$eval<
    ExtractedItem[],
    { titleSelector: string; linkSelector: string; dateSelector?: string; dateAttribute?: string; limit: number }
  >(
    itemSelector,
    (nodes, { titleSelector, linkSelector, dateSelector, dateAttribute, limit }) =>
      nodes.slice(0, limit).map((node) => {
        const titleEl = node.matches(titleSelector) ? node : node.querySelector(titleSelector);
        const linkEl = node.matches(linkSelector) ? node : node.querySelector(linkSelector);
        const title = titleEl?.textContent ?? "";
        const url = (linkEl as HTMLAnchorElement | null)?.href ?? "";
        // Gate 0：配了 dateSelector 才抽取日期文本；dateAttribute 用于 <time datetime> 类属性。
        let publishedAt: string | undefined;
        if (dateSelector) {
          const dateEl = node.matches(dateSelector) ? node : node.querySelector(dateSelector);
          const raw = dateAttribute ? dateEl?.getAttribute(dateAttribute) : dateEl?.textContent;
          publishedAt = raw?.trim() || undefined;
        }
        return { title: title.trim(), url, publishedAt };
      }),
    { titleSelector, linkSelector, dateSelector, dateAttribute, limit }
  );

  // Align with html.ts FETCH_HTML_EMPTY: zero itemSelector matches must fail the source,
  // not return [] (which handlers mark as success → silent permanent outage).
  if (extracted.length === 0) {
    throw new SourceFetchError(
      "FETCH_PLAYWRIGHT_EMPTY",
      "Playwright itemSelector matched no elements",
      { itemSelector, matched: 0, valid: 0 }
    );
  }

  // B-5 / A-6 收尾：itemSelector 命中但站点改版后 title/link 子选择器失配 → 每条标题为空
  // 或 href 回退成列表页 URL 本身。extracted.length > 0 不触发上面的零匹配错误，但产出
  // 全是垃圾/重复条目，fetch.ts 仍记为成功（静默断供变体）。
  // 按内容有效性过滤；全无效同样抛 FETCH_PLAYWRIGHT_EMPTY（复用同一错误码，detail 区分原因）。
  // 归一化 **finalUrl**（重定向后真实落点）：浏览器对空 href 解析成当前文档地址，不是
  // config.listUrl。用 listUrl 做基准时，302 后空 href 条目会漏过滤（T15a 缺陷 2）。
  let listUrlNormalized: string;
  try {
    listUrlNormalized = new URL(finalUrl).toString();
  } catch {
    listUrlNormalized = finalUrl;
  }
  const valid = extracted.filter((item) => {
    if (item.title.trim().length === 0) return false;
    if (item.url.trim().length === 0) return false;
    try {
      const resolved = new URL(item.url, finalUrl).toString();
      // 空 href 回退成列表页（最终落点）URL 本身（站点改版后 linkSelector 失配的典型信号）。
      if (resolved === listUrlNormalized) return false;
    } catch {
      return false;
    }
    return true;
  });

  if (valid.length === 0) {
    throw new SourceFetchError(
      "FETCH_PLAYWRIGHT_EMPTY",
      `Playwright itemSelector matched ${extracted.length} element(s) but all had empty title or link`,
      { itemSelector, matched: extracted.length, valid: 0 }
    );
  }
  return valid;
}
