import { SourceFetchError } from "@fe-radar/shared";
import type { FetchContext } from "../types";
import type { QuotesAdapter, QuoteSample } from "./types";

/**
 * Registry of quotes adapters keyed by adapter name.
 *
 * T-CB-07 / T-CB-08 will register concrete adapter implementations here.
 * Each adapter must honour the QuotesAdapter contract:
 *   - fetch() returns QuoteSample[] on success
 *   - fetch() returns [] on failure (never throws)
 *   - No LLM calls permitted (NFR-102)
 */
const adapterRegistry: Record<string, QuotesAdapter> = {};

/**
 * Register an adapter into the dispatcher registry.
 * Called by T-CB-07 / T-CB-08 adapter modules at module load time.
 */
export function registerAdapter(adapter: QuotesAdapter): void {
  adapterRegistry[adapter.name] = adapter;
}

/**
 * Source config shape for fetcher_type='quotes'.
 */
interface QuotesSourceConfig {
  adapter: string;
  metric_keys?: string[];
  endpoint?: string;
  retry?: { max: number; backoffMs: number };
  raw_text_keep?: boolean;
  regex_rules?: unknown[];
}

/**
 * Dispatch a quotes fetch to the correct adapter based on
 * sourceConfig.config.adapter.
 *
 * Unknown adapter name → throws SourceFetchError(FETCH_ADAPTER_UNKNOWN).
 * Adapter fetch failure → returns [] (adapter is responsible for swallowing
 * its own errors; this layer propagates unknown-adapter errors so the job
 * layer can markSourceFailure accordingly).
 */
export async function fetchQuotes(
  sourceConfig: { id?: number; name: string; config: unknown },
  ctx: FetchContext
): Promise<QuoteSample[]> {
  const config = sourceConfig.config as QuotesSourceConfig;
  const adapterName = config?.adapter;

  if (!adapterName || !(adapterName in adapterRegistry)) {
    throw new SourceFetchError(
      "FETCH_ADAPTER_UNKNOWN",
      `No quotes adapter registered for "${adapterName}"`,
      { source: ctx.sourceName, adapter: adapterName }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const adapter = adapterRegistry[adapterName]!;
  return adapter.fetch(ctx);
}
