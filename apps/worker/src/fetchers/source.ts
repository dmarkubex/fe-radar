import { fetchAnnouncements } from "./announcements";
import { fetchCrawl } from "./crawl";
import { dataproAdapter } from "./datapro/adapter";
import { fetchHtml } from "./html";
import { fetchPlaywright, type BrowserContextPool } from "./playwright";
import { fetchRss } from "./rss";
import { getOrCreatePlaywrightPool } from "../lib/playwright-pool";
import type { FetchContext, SourceConfig, StandardItem } from "./types";

export async function fetchSourceItems(
  config: SourceConfig,
  context: FetchContext,
  playwrightPool?: BrowserContextPool
): Promise<StandardItem[]> {
  switch (config.type) {
    case "rss":
      return fetchRss(config, context);
    case "html":
      return fetchHtml(config, context);
    case "playwright":
      // T-CA-04: 无传入 pool 时走全局 getter（禁止直接 createPlaywrightPool；
      // 单例由 closePlaywrightPool 在进程退出时关闭，此处禁止 pool.close()）。
      return fetchPlaywright(
        config,
        context,
        playwrightPool ?? (await getOrCreatePlaywrightPool())
      );
    case "announcement":
      return fetchAnnouncements(config, context);
    case "crawl":
      return fetchCrawl(config, context);
    case "datapro":
      return dataproAdapter.fetch(config, context);
    default:
      throw new Error(
        `Unknown fetcher type: ${(config as { type: string }).type}`
      );
  }
}
