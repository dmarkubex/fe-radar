import Parser from "rss-parser";
import { SourceFetchError } from "@fe-radar/shared";
import { fetchTextWithPolicy } from "./http";
import type { FetchContext, RssSourceConfig, StandardItem } from "./types";

// RSS feed 拉取超时（ms）。RSSHub 冷缓存回源 jiemian/yicai 需 30-90s，4s 过短；
// 可经 RSS_FETCH_TIMEOUT_MS 覆盖；非正数 / NaN 回退默认 15000。
const RSS_FETCH_TIMEOUT_MS = (() => {
  const v = Number(process.env.RSS_FETCH_TIMEOUT_MS ?? 15000);
  return Number.isFinite(v) && v > 0 ? v : 15000;
})();

const parser = new Parser();

export async function fetchRss(config: RssSourceConfig, context: FetchContext, fetchImpl?: typeof fetch): Promise<StandardItem[]> {
  try {
    const xml = await fetchTextWithPolicy(config.url, { timeoutMs: RSS_FETCH_TIMEOUT_MS, useRealUa: context.useRealUa, fetchImpl });
    const feed = await parser.parseString(xml);
    return feed.items.map((item) => {
      const title = item.title?.trim();
      const url = item.link?.trim();
      if (!title || !url) {
        throw new SourceFetchError("FETCH_RSS_INVALID", "RSS item misses title or link", { source: context.sourceName });
      }
      return {
        title,
        url,
        content: (item.contentSnippet ?? item.content ?? title).trim(),
        publishedAt: item.isoDate ? new Date(item.isoDate) : new Date(item.pubDate ?? Date.now())
      };
    });
  } catch (error) {
    if (error instanceof SourceFetchError) {
      throw error;
    }
    throw new SourceFetchError("FETCH_RSS_INVALID", "Failed to parse RSS source", { source: context.sourceName, cause: error });
  }
}
