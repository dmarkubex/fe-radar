import { fetchAnnouncements } from "./announcements";
import { fetchCrawl } from "./crawl";
import { dataproAdapter } from "./datapro/adapter";
import { fetchHtml } from "./html";
import {
  createPlaywrightPool,
  fetchPlaywright,
  type BrowserContextPool
} from "./playwright";
import { fetchRss } from "./rss";
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
    case "playwright": {
      const pool = playwrightPool ?? (await createPlaywrightPool());
      try {
        return await fetchPlaywright(config, context, pool);
      } finally {
        if (!playwrightPool) await pool.close();
      }
    }
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
