import { SourceFetchError } from "@fe-radar/shared";
import type { CrawlSourceConfig, CrawlAdapter } from "./types";
import type { FetchContext, StandardItem } from "../types";
import { firecrawlAdapter } from "./firecrawl-adapter";

const adapterRegistry: Record<string, CrawlAdapter> = {};

export function registerCrawlAdapter(adapter: CrawlAdapter): void {
  adapterRegistry[adapter.name] = adapter;
}

export async function fetchCrawl(
  config: CrawlSourceConfig,
  ctx: FetchContext
): Promise<StandardItem[]> {
  const adapterName = config.adapter;
  const adapter = adapterRegistry[adapterName];

  if (!adapterName || !adapter) {
    throw new SourceFetchError(
      "FETCH_ADAPTER_UNKNOWN",
      `No crawl adapter registered for "${adapterName}"`,
      { source: ctx.sourceName, adapter: adapterName }
    );
  }

  return adapter.fetch(config, ctx);
}

registerCrawlAdapter(firecrawlAdapter);

export * from "./types";
export * from "./firecrawl-client";
export * from "./risk-filter";
