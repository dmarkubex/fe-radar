import { isRelevantRiskResult, matchesAnyKeyword } from "@fe-radar/core";
import { SourceFetchError } from "@fe-radar/shared";
import type { StandardItem } from "../types";
import { dedupeStandardItems } from "../announcements/litigation-filter";
import type { CrawlSourceConfig, FirecrawlSearchResult } from "./types";

// Built-in URL patterns that identify noise pages
const BUILTIN_NOISE_URL_SUBSTRINGS = ["/realstock/", "/company/", "quote.", "guba."] as const;

// Site suffix patterns stripped from titles (order matters: longer first)
const TITLE_SITE_SUFFIXES = ["_新浪财经", "_东方财富网", "_东方财富", "_新浪"] as const;

// Regex: title contains a 6-digit stock code AND at least one noise keyword → noise page
const STOCK_CODE_RE = /\d{6}/;
const BUILTIN_NOISE_TITLE_KEYWORDS = ["行情", "新股发行", "股吧", "_新浪财经", "_东方财富"] as const;

function matchesPattern(text: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return text.toLowerCase().includes(pattern.toLowerCase());
  }
}

export function isNoisePage(url: string, title: string, config: CrawlSourceConfig): boolean {
  const lowerUrl = url.toLowerCase();

  for (const pattern of BUILTIN_NOISE_URL_SUBSTRINGS) {
    if (lowerUrl.includes(pattern)) {
      return true;
    }
  }

  if (STOCK_CODE_RE.test(title)) {
    const hasNoiseKeyword = BUILTIN_NOISE_TITLE_KEYWORDS.some((kw) => title.includes(kw));
    if (hasNoiseKeyword) {
      return true;
    }
  }

  if (Array.isArray(config.excludeUrlPatterns)) {
    for (const pattern of config.excludeUrlPatterns) {
      if (typeof pattern === "string" && pattern.trim() && matchesPattern(url, pattern)) {
        return true;
      }
    }
  }

  if (Array.isArray(config.excludeTitlePatterns)) {
    for (const pattern of config.excludeTitlePatterns) {
      if (typeof pattern === "string" && pattern.trim() && matchesPattern(title, pattern)) {
        return true;
      }
    }
  }

  return false;
}

function stripTitleSiteSuffix(title: string): string {
  for (const suffix of TITLE_SITE_SUFFIXES) {
    if (title.endsWith(suffix)) {
      return title.slice(0, -suffix.length).trimEnd();
    }
  }
  return title;
}

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
  const rawTitle = result.title?.trim() || result.metadata?.title?.trim();
  if (!url || !rawTitle) {
    return null;
  }

  const title = stripTitleSiteSuffix(rawTitle);

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
  if (config.riskFilter !== true) {
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

  return items
    .filter((item) => !isNoisePage(item.url, item.title, config))
    .filter((item) => {
      if (config.requireRiskKeywordInTitle === true) {
        return (
          matchesAnyKeyword(item.title, riskKeywords) &&
          matchesAnyKeyword(`${item.title}\n${item.content}`, entityKeywords)
        );
      }
      return isRelevantRiskResult(item.title, item.content, entityKeywords, riskKeywords);
    });
}

export function mergeFirecrawlResults(items: StandardItem[]): StandardItem[] {
  return dedupeStandardItems(items);
}
