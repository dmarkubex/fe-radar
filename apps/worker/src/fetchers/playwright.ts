import { SourceFetchError } from "@fe-radar/shared";
import { acquireUserAgent } from "../lib/ua-pool";
import { proxyPool } from "../lib/proxy-pool";
import { assertRobotsAllowed } from "../lib/robots";
import type { FetchContext, PlaywrightSourceConfig, StandardItem } from "./types";

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

interface PageLike {
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
  waitForSelector(selector: string, options: { timeout: number }): Promise<unknown>;
  evaluate(fn: () => ExtractedItem[]): Promise<ExtractedItem[]>;
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
  const userAgent = acquireUserAgent(context.useRealUa);
  await assertRobotsAllowed(config.listUrl, userAgent, robotsFetch ?? fetch);
  const proxy = proxyPool.acquire();
  const browserContext = await pool.acquire(userAgent, proxy?.server ? { server: proxy.server } : undefined);
  const page = await browserContext.newPage();

  try {
    await page.goto(config.listUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector(config.waitFor, { timeout: 30000 });
    const extractor = compileExtractor(config.extractor);
    const extracted = await page.evaluate(extractor);
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

export function compileExtractor(source: string): () => ExtractedItem[] {
  if (!source.startsWith("() =>")) {
    throw new SourceFetchError("FETCH_PLAYWRIGHT_EXTRACTOR", "Extractor must be an arrow function without arguments");
  }

  if (/\b(window|globalThis|Function|eval|process|require)\b/.test(source)) {
    throw new SourceFetchError("FETCH_PLAYWRIGHT_EXTRACTOR", "Extractor uses blocked globals");
  }

  return new Function(`"use strict"; return (${source});`)() as () => ExtractedItem[];
}
