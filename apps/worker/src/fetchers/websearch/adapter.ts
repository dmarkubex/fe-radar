import { scrubText } from "@fe-radar/core";
import { createLogger } from "@fe-radar/shared";
import type { FetchContext, StandardItem } from "../types";
import { websearchSearch } from "./client";
import type { WebsearchAdapter, WebsearchResult, WebsearchSourceConfig } from "./types";

const logger = createLogger({ service: "websearch-adapter" });

/**
 * 豆包搜索（Doubao Web Search）适配器
 *
 * 直连豆包搜索 REST API，将搜索结果映射为 StandardItem[]。
 *
 * 约束：
 * - 失败返回 [] 不抛异常（websearch 有独立 job handler，不走通用 fetch handler）
 * - query 发送前必经 scrubText 检查；若 level='block' 则跳过（PII 阈值）
 * - 禁止在 fetcher 层调 LLM
 * - 禁止存原始 HTML（只存 Snippet 文本）
 */

interface RuntimeConfig extends WebsearchSourceConfig {
  query?: string;
}

function resolveRuntimeConfig(ctx: FetchContext): RuntimeConfig {
  return (ctx.sourceConfig ?? {}) as unknown as RuntimeConfig;
}

function parsePublishedAt(value?: string): Date {
  if (!value?.trim()) {
    return new Date();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function mapWebsearchResultToStandardItem(result: WebsearchResult): StandardItem | null {
  const url = result.Url?.trim();
  const title = result.Title?.trim();
  if (!url || !title) {
    return null;
  }

  return {
    url,
    title,
    content: result.Snippet?.trim() || result.Summary?.trim() || "",
    publishedAt: parsePublishedAt(result.PublishTime),
  };
}

async function fetchWebsearch(ctx: FetchContext): Promise<StandardItem[]> {
  const config = resolveRuntimeConfig(ctx);
  const query = typeof config.query === "string" ? config.query.trim() : "";
  if (!query) {
    return [];
  }

  // scrubText 检查：命中 PII 阈值（level='block'）跳过本次搜索
  const scrubbed = scrubText(query);
  if (scrubbed.level === "block") {
    return [];
  }

  let results: WebsearchResult[];
  try {
    results = await websearchSearch(scrubbed.cleaned, {
      timeRange: config.timeRange,
      count: config.count,
      authInfoLevel: config.authInfoLevel,
    });
  } catch (error) {
    // P2-1: 保留可观测性 — 失败时打 warn 日志，再返回 []（websearch 有独立 job handler）
    logger.warn({ query, error }, "websearch adapter: client call failed, returning empty");
    return [];
  }

  return results
    .map(mapWebsearchResultToStandardItem)
    .filter((item): item is StandardItem => item !== null);
}

export const websearchAdapter: WebsearchAdapter = {
  name: "doubao",
  fetch: fetchWebsearch,
};

export { fetchWebsearch };
