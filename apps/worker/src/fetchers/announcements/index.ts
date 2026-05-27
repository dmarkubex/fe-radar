import { SourceFetchError } from "@fe-radar/shared";
import type { AnnouncementSourceConfig, FetchContext, StandardItem } from "../types";
import type { AnnouncementAdapter } from "./types";

const adapterRegistry: Record<string, AnnouncementAdapter> = {};

export function registerAnnouncementAdapter(adapter: AnnouncementAdapter): void {
  adapterRegistry[adapter.name] = adapter;
}

export async function fetchAnnouncements(
  config: AnnouncementSourceConfig,
  ctx: FetchContext
): Promise<StandardItem[]> {
  const adapterName = config.adapter;

  const adapter = adapterRegistry[adapterName];

  if (!adapterName || !adapter) {
    throw new SourceFetchError(
      "FETCH_ADAPTER_UNKNOWN",
      `No announcement adapter registered for "${adapterName}"`,
      { source: ctx.sourceName, adapter: adapterName }
    );
  }

  return adapter.fetch({
    ...ctx,
    sourceConfig: config,
  });
}
