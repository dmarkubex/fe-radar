import { isRelevantRiskResult } from "@fe-radar/core";
import { SourceFetchError } from "@fe-radar/shared";
import type { StandardItem } from "../types";
import { dedupeStandardItems } from "../announcements/litigation-filter";
import type { CrawlSourceConfig, FirecrawlSearchResult } from "./types";

export function resolveCrawlQueries(config: CrawlSourceConfig): string[] {
  if (!Array.isArray(config.queries)) {
    return [];
  }
  return config.queries
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

export function resolveIncludeDomains(config: CrawlSourceConfig): string[] {
  if (Array.isArray(config.includeDomains) && config.includeDomains.length > 0) {
    const domains = config.includeDomains.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    if (domains.length > 0) {
      return domains;
    }
  }
  throw new SourceFetchError("FETCH_CONFIG", "crawl source requires includeDomains in source config");
}

export function truncateContent(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}…`;
}

export function parsePublishedAt(result: FirecrawlSearchResult): Date {
  const candidates = [
    result.metadata?.publishedTime,
    result.metadata?.modifiedTime,
  ];
  for (const value of candidates) {
    if (!value?.trim()) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

export function resolveResultContent(result: FirecrawlSearchResult, maxLength: number): string {
  const description = result.description?.trim() || result.metadata?.description?.trim() || "";
  if (description) {
    return truncateContent(description, maxLength);
  }
  return result.title?.trim() ?? "";
}

export function mapFirecrawlResultToStandardItem(
  result: FirecrawlSearchResult,
  maxContentLength: number
): StandardItem | null {
  const url = result.url?.trim() || result.metadata?.sourceURL?.trim();
  const title = result.title?.trim() || result.metadata?.title?.trim();
  if (!url || !title) {
    return null;
  }

  return {
    url,
    title,
    content: resolveResultContent(result, maxContentLength),
    publishedAt: parsePublishedAt(result),
  };
}

export function filterRiskResults(
  items: StandardItem[],
  config: CrawlSourceConfig
): StandardItem[] {
  if (config.riskFilter === false) {
    return items;
  }

  const entityKeywords = Array.isArray(config.entityKeywords)
    ? config.entityKeywords.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : undefined;
  const riskKeywords = Array.isArray(config.riskKeywords)
    ? config.riskKeywords.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : undefined;

  if (!entityKeywords?.length || !riskKeywords?.length) {
    throw new SourceFetchError("FETCH_CONFIG", "crawl riskFilter requires entityKeywords and riskKeywords");
  }

  return items.filter((item) =>
    isRelevantRiskResult(
      item.title,
      item.content,
      entityKeywords,
      riskKeywords
    )
  );
}

export function mergeFirecrawlResults(items: StandardItem[]): StandardItem[] {
  return dedupeStandardItems(items);
}
