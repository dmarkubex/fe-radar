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
  /** 结果须同时命中实体词 + 风险词，默认 true */
  riskFilter?: boolean;
  entityKeywords?: string[];
  riskKeywords?: string[];
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
