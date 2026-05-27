import type { FetchContext, StandardItem } from "../types";

/**
 * Interface every announcement adapter must implement.
 *
 * Adapter failures must return [] instead of throwing. Fetcher dispatch only
 * throws for configuration errors such as an unknown adapter name. LLM calls
 * are not allowed in announcement adapters.
 */
export interface AnnouncementAdapter {
  name: string;
  fetch(ctx: FetchContext): Promise<StandardItem[]>;
}
