import { SourceFetchError } from "@fe-radar/shared";
import { acquireUserAgent } from "../lib/ua-pool";
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
  private contexts: BrowserContextLike[] = [];
  private cursor = 0;

  public constructor(private readonly browserFactory: () => Promise<BrowserLike>) {}

  public async acquire(userAgent: string, proxy?: { server: string }): Promise<BrowserContextLike> {
    if (this.contexts.length < MAX_CONTEXTS) {
      const browser = await this.browserFactory();
      const context = await browser.newContext({ userAgent, proxy });
      this.contexts.push(context);
      return context;
    }

    const context = this.contexts[this.cursor % this.contexts.length];
    this.cursor += 1;
    if (!context) {
      throw new SourceFetchError("FETCH_PLAYWRIGHT_POOL", "Browser context pool is empty");
    }
    return context;
  }

  public async close(): Promise<void> {
    await Promise.all(this.contexts.map((context) => context.close()));
    this.contexts = [];
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
  const browserContext = await pool.acquire(userAgent);
  const page = await browserContext.newPage();

  try {
    await page.goto(config.listUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector(config.waitFor, { timeout: 30000 });
    const extractor = compileExtractor(config.extractor);
    const extracted = await page.evaluate(extractor);
    return extracted.map((item) => ({
      title: item.title.trim(),
      url: new URL(item.url, config.listUrl).toString(),
      content: (item.content ?? item.title).trim(),
      publishedAt: item.publishedAt ? new Date(item.publishedAt) : new Date()
    }));
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
