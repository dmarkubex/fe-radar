import { SourceFetchError } from "@fe-radar/shared";
import type { StandardItem } from "../types";

export function resolveTitleKeywords(config: Record<string, unknown>): string[] {
  const titleKeywords = config.titleKeywords;
  if (Array.isArray(titleKeywords)) {
    const cleaned = titleKeywords.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    if (cleaned.length > 0) {
      return cleaned;
    }
  }

  if (typeof titleKeywords === "string" && titleKeywords.trim()) {
    return [titleKeywords.trim()];
  }

  const searchkey = typeof config.searchkey === "string" ? config.searchkey.trim() : "";
  if (searchkey) {
    return [searchkey];
  }

  if (config.litigationFilter === true) {
    throw new SourceFetchError("FETCH_CONFIG", "announcement litigationFilter requires titleKeywords or searchkey");
  }

  return [];
}

export function filterItemsByTitleKeywords(items: StandardItem[], keywords: string[]): StandardItem[] {
  if (keywords.length === 0) {
    return items;
  }

  return items.filter((item) => keywords.some((keyword) => item.title.includes(keyword)));
}

export function dedupeStandardItems(items: StandardItem[]): StandardItem[] {
  const seen = new Set<string>();
  const deduped: StandardItem[] = [];

  for (const item of items) {
    if (seen.has(item.url)) {
      continue;
    }
    seen.add(item.url);
    deduped.push(item);
  }

  return deduped;
}
