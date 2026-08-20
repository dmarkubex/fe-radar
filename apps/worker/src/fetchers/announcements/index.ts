import { SourceFetchError } from "@fe-radar/shared";
import type {
  AnnouncementSourceConfig,
  FetchContext,
  StandardItem
} from "../types";
import { cninfoAdapter } from "./cninfo";
import { chnEnergyTenderAdapter } from "./chnenergy-tender";
import { neaNewsAdapter } from "./nea-news";
import {
  huaweiDigitalPowerNewsAdapter,
  nexansNewsAdapter
} from "./official-news";
import { powerChinaTenderAdapter } from "./powerchina-tender";
import { sgccTenderAdapter } from "./sgcc-tender";
import { sseAdapter } from "./sse";
import type { AnnouncementAdapter } from "./types";
import { szseAdapter } from "./szse";
import {
  applyAnnouncementEntityFilter,
  buildCompanyNameSet,
  loadCompanyNameRows,
  resolveEntityFilterSeparators,
  type CompanyNameRow
} from "./entity-filter";

const adapterRegistry: Record<string, AnnouncementAdapter> = {};

export function registerAnnouncementAdapter(
  adapter: AnnouncementAdapter
): void {
  adapterRegistry[adapter.name] = adapter;
}

export interface FetchAnnouncementsDeps {
  /** 测试注入；生产默认按源查一次 type=company 词典。 */
  loadCompanyNames?: () => Promise<CompanyNameRow[]>;
}

export async function fetchAnnouncements(
  config: AnnouncementSourceConfig,
  ctx: FetchContext,
  deps: FetchAnnouncementsDeps = {}
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

  const items = await adapter.fetch({
    ...ctx,
    sourceConfig: config
  });

  const entityFilter = config.entityFilter;
  if (!entityFilter?.enabled) {
    return items;
  }

  const rows = deps.loadCompanyNames
    ? await deps.loadCompanyNames()
    : await loadCompanyNameRows();
  const nameSet = buildCompanyNameSet(rows);
  return applyAnnouncementEntityFilter(
    items,
    nameSet,
    ctx.sourceName,
    resolveEntityFilterSeparators(entityFilter)
  );
}

registerAnnouncementAdapter(sseAdapter);
registerAnnouncementAdapter(szseAdapter);
registerAnnouncementAdapter(cninfoAdapter);
registerAnnouncementAdapter(neaNewsAdapter);
registerAnnouncementAdapter(sgccTenderAdapter);
registerAnnouncementAdapter(powerChinaTenderAdapter);
registerAnnouncementAdapter(chnEnergyTenderAdapter);
registerAnnouncementAdapter(nexansNewsAdapter);
registerAnnouncementAdapter(huaweiDigitalPowerNewsAdapter);
