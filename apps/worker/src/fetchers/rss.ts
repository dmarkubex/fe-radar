import Parser from "rss-parser";
import { SourceFetchError } from "@fe-radar/shared";
import { fetchTextWithPolicy } from "./http";
import type { FetchContext, RssSourceConfig, StandardItem } from "./types";

const parser = new Parser();

export async function fetchRss(config: RssSourceConfig, context: FetchContext, fetchImpl?: typeof fetch): Promise<StandardItem[]> {
  try {
    const xml = await fetchTextWithPolicy(config.url, { timeoutMs: 4000, useRealUa: context.useRealUa, fetchImpl });
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
