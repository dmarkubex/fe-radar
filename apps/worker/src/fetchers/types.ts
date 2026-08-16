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
  keywordFilter?: string[];
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
  /** T-SEC-03: 声明式 CSS 选择器取代编辑员可执行 extractor 字符串（new Function RCE）。 */
  itemSelector: string;
  titleSelector?: string;
  linkSelector?: string;
  /** Gate 0：声明式日期选择器；配置后条目必须能解析出真实发布时间，否则丢弃。 */
  dateSelector?: string;
  /** 配合 dateSelector 读属性值（如 `<time datetime>`）；不配置则读 textContent。 */
  dateAttribute?: string;
  limit?: number;
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

export type SourceConfig =
  | RssSourceConfig
  | HtmlSourceConfig
  | PlaywrightSourceConfig
  | AnnouncementSourceConfig
  | CrawlSourceConfig
  | DataproSourceConfig
  | WebsearchSourceConfig;
