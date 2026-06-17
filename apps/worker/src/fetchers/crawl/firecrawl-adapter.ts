/**
 * Firecrawl search adapter — C1 风险检索
 *
 * 仅使用 search 结果的 title + description（不请求 rawHtml / markdown 全文）。
 * 无 FIRECRAWL_API_KEY 时抛 FETCH_CONFIG，避免 enabled source 静默成功。
 */

import { SourceFetchError } from "@fe-radar/shared";
import type { FetchContext, StandardItem } from "../types";
import { assertRobotsAllowed } from "../../lib/robots";
import { acquireUserAgent } from "../../lib/ua-pool";
import { firecrawlSearch, resolveFirecrawlApiKey } from "./firecrawl-client";
import {
  filterRiskResults,
  mapFirecrawlResultToStandardItem,
  mergeFirecrawlResults,
  resolveCrawlQueries,
  resolveIncludeDomains,
} from "./risk-filter";
import type { CrawlAdapter, CrawlSourceConfig, FirecrawlSearchResult } from "./types";

const DEFAULT_LIMIT = 5;
const DEFAULT_MAX_CONTENT = 1200;

function flattenSearchResults(response: Awaited<ReturnType<typeof firecrawlSearch>>): FirecrawlSearchResult[] {
  const web = response.data?.web ?? [];
  const news = response.data?.news ?? [];
  return [...web, ...news];
}

async function filterRobotsAllowedItems(items: StandardItem[], ctx: FetchContext): Promise<StandardItem[]> {
  const userAgent = acquireUserAgent(ctx.useRealUa ?? true);
  const allowed: StandardItem[] = [];
  for (const item of items) {
    try {
      await assertRobotsAllowed(item.url, userAgent);
      allowed.push(item);
    } catch {
      // Firecrawl search results are discarded unless the target URL passes our local robots guard.
    }
  }
  return allowed;
}

export const firecrawlAdapter: CrawlAdapter = {
  name: "firecrawl",

  async fetch(config: CrawlSourceConfig, ctx: FetchContext): Promise<StandardItem[]> {
    // 一个 enabled crawl 源缺少 API key 属于配置错误，必须显式失败而非静默返回 []，
    // 否则 401 / 配额 / secret 缺失会被记录成抓取成功（评审 finding 2）。
    if (!resolveFirecrawlApiKey()) {
      throw new SourceFetchError("FETCH_CONFIG", "FIRECRAWL_API_KEY is not configured", {
        source: ctx.sourceName,
      });
    }

    const queries = resolveCrawlQueries(config);
    if (queries.length === 0) {
      throw new SourceFetchError("FETCH_CONFIG", "crawl source requires non-empty queries array", {
        source: ctx.sourceName,
      });
    }

    const limit = typeof config.limit === "number" && config.limit > 0 ? Math.min(config.limit, 20) : DEFAULT_LIMIT;
    const maxContentLength =
      typeof config.maxContentLength === "number" && config.maxContentLength > 0
        ? config.maxContentLength
        : DEFAULT_MAX_CONTENT;
    const includeDomains = resolveIncludeDomains(config);
    const excludeDomains = Array.isArray(config.excludeDomains)
      ? config.excludeDomains.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : undefined;

    const merged: StandardItem[] = [];
    let successCount = 0;
    const failedQueries: string[] = [];
    let lastError: unknown;

    for (const query of queries) {
      try {
        const response = await firecrawlSearch({
          query,
          limit,
          includeDomains,
          excludeDomains,
          country: typeof config.country === "string" ? config.country : "CN",
          location: typeof config.location === "string" ? config.location : "China",
          tbs: typeof config.tbs === "string" ? config.tbs : "qdr:w",
          sources: [{ type: "web" }, { type: "news" }],
        });

        const mapped = flattenSearchResults(response)
          .map((result) => mapFirecrawlResultToStandardItem(result, maxContentLength))
          .filter((item): item is StandardItem => item !== null);

        merged.push(...await filterRobotsAllowedItems(mapped, ctx));
        successCount += 1;
      } catch (error) {
        if (error instanceof SourceFetchError && error.code === "FETCH_CONFIG") {
          throw error;
        }
        // 单 query 失败不阻断其余 query，但记录失败以便全失败时上报。
        failedQueries.push(query);
        lastError = error;
      }
    }

    // 全部 query 失败（401 / 配额 / 网络）必须抛错走 source failure，不能静默成功。
    if (successCount === 0) {
      if (lastError instanceof SourceFetchError) {
        throw lastError;
      }
      throw new SourceFetchError(
        "FETCH_ALL_QUERIES_FAILED",
        `Firecrawl search failed for all ${queries.length} query(ies): ${failedQueries.join(" | ")}`,
        { source: ctx.sourceName, cause: lastError }
      );
    }

    return filterRiskResults(mergeFirecrawlResults(merged), config);
  },
};
