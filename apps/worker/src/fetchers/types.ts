export interface StandardItem {
  url: string;
  title: string;
  content: string;
  publishedAt: Date;
}

export interface FetchContext {
  sourceName: string;
  useRealUa?: boolean;
  /** Optional per-source configuration passed from the job layer to adapters. */
  sourceConfig?: Record<string, unknown>;
}

export interface RssSourceConfig {
  type: "rss";
  url: string;
  keywordFilter?: string[];
}

export interface HtmlSourceConfig {
  type: "html";
  listUrl: string;
  insecureTLS?: boolean;
  selectors: {
    item: string;
    title: string;
    link: string;
    date: string;
    content?: string;
  };
}

export interface PlaywrightSourceConfig {
  type: "playwright";
  listUrl: string;
  waitFor: string;
  extractor: string;
}

export interface AnnouncementSourceConfig {
  type: "announcement";
  adapter: string;
  [key: string]: unknown;
}

import type { CrawlSourceConfig } from "./crawl/types";
import type { DataproSourceConfig } from "./datapro/types";
import type { WebsearchSourceConfig } from "./websearch/types";

export type { CrawlSourceConfig };
export type { DataproSourceConfig };
export type { WebsearchSourceConfig };

export type SourceConfig = RssSourceConfig | HtmlSourceConfig | PlaywrightSourceConfig | AnnouncementSourceConfig | CrawlSourceConfig | DataproSourceConfig | WebsearchSourceConfig;
