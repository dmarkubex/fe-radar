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
}

export interface HtmlSourceConfig {
  type: "html";
  listUrl: string;
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

export interface CrawlSourceConfig {
  type: "crawl";
  adapter: string;
  queries: string[];
  [key: string]: unknown;
}

export type SourceConfig = RssSourceConfig | HtmlSourceConfig | PlaywrightSourceConfig | AnnouncementSourceConfig | CrawlSourceConfig;
