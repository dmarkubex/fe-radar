import Parser from "rss-parser";
import { createLogger, SourceFetchError } from "@fe-radar/shared";
import { fetchTextWithPolicy } from "./http";
import type { FetchContext, RssSourceConfig, StandardItem } from "./types";

const logger = createLogger({ service: "fetch-rss" });

// RSS feed 拉取超时（ms）。RSSHub 冷缓存回源 jiemian/yicai 需 30-90s，4s 过短；
// 可经 RSS_FETCH_TIMEOUT_MS 覆盖；非正数 / NaN 回退默认 15000。
const RSS_FETCH_TIMEOUT_MS = (() => {
  const v = Number(process.env.RSS_FETCH_TIMEOUT_MS ?? 15000);
  return Number.isFinite(v) && v > 0 ? v : 15000;
})();

// T-SEC-07: RSS 响应在缓冲和解析前必须有字节上限。恶意 / 被劫持 feed 可发超大响应
// 耗尽 worker 内存；timeout 不提供确定的字节上限。默认 2MB（RSS feed 正常 <1MB）。
const RSS_MAX_RESPONSE_BYTES = (() => {
  const v = Number(process.env.RSS_MAX_RESPONSE_BYTES ?? 2 * 1024 * 1024);
  return Number.isFinite(v) && v > 0 ? v : 2 * 1024 * 1024;
})();

const parser = new Parser();

export async function fetchRss(config: RssSourceConfig, context: FetchContext, fetchImpl?: typeof fetch): Promise<StandardItem[]> {
  try {
    const xml = await fetchTextWithPolicy(config.url, { timeoutMs: RSS_FETCH_TIMEOUT_MS, useRealUa: context.useRealUa, maxResponseBytes: RSS_MAX_RESPONSE_BYTES, fetchImpl });
    const feed = await parser.parseString(xml);
    // Align with sse/announcement adapters: skip malformed records, keep valid ones.
    // Throwing on a single bad item used to zero the whole feed every cycle.
    const items: StandardItem[] = [];
    let skipped = 0;
    for (const item of feed.items) {
      const title = item.title?.trim();
      const url = item.link?.trim();
      if (!title || !url) {
        skipped += 1;
        continue;
      }
      items.push({
        title,
        url,
        content: (item.contentSnippet ?? item.content ?? title).trim(),
        publishedAt: item.isoDate ? new Date(item.isoDate) : new Date(item.pubDate ?? Date.now())
      });
    }
    if (skipped > 0) {
      logger.warn(
        { source: context.sourceName, skipped, total: feed.items.length, kept: items.length },
        "RSS items skipped due to missing title or link"
      );
    }
    if (items.length === 0) {
      throw new SourceFetchError(
        "FETCH_RSS_INVALID",
        "RSS feed has no valid items (all missing title or link)",
        { source: context.sourceName, skipped, total: feed.items.length }
      );
    }
    // 与 html.ts keywordFilter 语义一致：title + content 包含任一关键词（大小写敏感）才保留。
    const filtered = config.keywordFilter?.length
      ? items.filter((item) =>
          config.keywordFilter!.some((keyword) => `${item.title} ${item.content}`.includes(keyword))
        )
      : items;
    // keywordFilter 收窄导致 0 条是业务空窗，不是抓取故障。抛 SourceFetchError
    // 会被 fetch.ts 计入 fail_count，连续命中会自动禁用生产源（0042 已给 36氪等
    // 4 个在用 rss 源配了 keywordFilter）。feed 本身 0 条仍走上方 FETCH_RSS_INVALID。
    if (filtered.length === 0) {
      logger.debug(
        {
          source: context.sourceName,
          keywords: config.keywordFilter,
          total: items.length
        },
        "RSS items all filtered out by keywordFilter"
      );
      return [];
    }
    return filtered;
  } catch (error) {
    if (error instanceof SourceFetchError) {
      throw error;
    }
    throw new SourceFetchError("FETCH_RSS_INVALID", "Failed to parse RSS source", { source: context.sourceName, cause: error });
  }
}
