export interface StandardItem {
  url: string;
  title: string;
  content: string;
  publishedAt: Date;
}

export interface FetchContext {
  sourceName: string;
  useRealUa?: boolean;
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

export type SourceConfig = RssSourceConfig | HtmlSourceConfig | PlaywrightSourceConfig;
