import type { FetchContext, StandardItem } from "../types";

export interface WebsearchSourceConfig {
  type: "websearch";
  timeRange?: "OneDay" | "OneWeek" | "OneMonth" | "OneYear";
  count?: number;
  authInfoLevel?: number;
}

export interface WebsearchAdapter {
  name: string;
  fetch(ctx: FetchContext): Promise<StandardItem[]>;
}

export interface WebsearchResult {
  Id?: string;
  Title?: string;
  SiteName?: string;
  Url?: string;
  Snippet?: string;
  Summary?: string;
  Content?: string;
  PublishTime?: string;
}
