import type { FetchContext, StandardItem } from "../types";

export interface CrawlAdapter {
  name: string;
  fetch(config: CrawlSourceConfig, ctx: FetchContext): Promise<StandardItem[]>;
}

export interface CrawlSourceConfig {
  type: "crawl";
  adapter: string;
  queries: string[];
  limit?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  country?: string;
  location?: string;
  /** Firecrawl tbs，默认 qdr:w（近一周） */
  tbs?: string;
  /** 为 true 时结果须同时命中 entityKeywords + riskKeywords；未设置或 false 时不做风险过滤 */
  riskFilter?: boolean;
  entityKeywords?: string[];
  riskKeywords?: string[];
  /** URL substring or regex patterns to exclude as noise (case-insensitive) */
  excludeUrlPatterns?: string[];
  /** Title substring or regex patterns to exclude as noise (case-insensitive) */
  excludeTitlePatterns?: string[];
  /** When true, riskFilter requires a risk keyword to appear in the title (not just content) */
  requireRiskKeywordInTitle?: boolean;
  /** 摘要最大字符数（不存 HTML） */
  maxContentLength?: number;
  [key: string]: unknown;
}

export interface FirecrawlSearchResult {
  url?: string;
  title?: string;
  description?: string;
  markdown?: string | null;
  metadata?: {
    title?: string;
    description?: string;
    publishedTime?: string;
    modifiedTime?: string;
    sourceURL?: string;
  };
}

export interface FirecrawlSearchResponse {
  success?: boolean;
  data?: {
    web?: FirecrawlSearchResult[];
    news?: FirecrawlSearchResult[];
  };
  error?: string;
}

export interface FirecrawlSearchRequest {
  query: string;
  limit?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  country?: string;
  location?: string;
  tbs?: string;
  sources?: Array<{ type: "web" | "news" }>;
}
