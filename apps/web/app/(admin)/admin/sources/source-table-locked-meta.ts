type FetcherType = "rss" | "html" | "playwright" | "quotes" | "announcement" | "crawl";

export interface SourceRow {
  id: number;
  name: string;
  url: string;
  urlLocked: boolean;
  fetcherType: FetcherType;
  config: unknown;
  tier: "T1" | "T2" | "T3";
  category: string | null;
  enabled: boolean;
  lastOkAt: string | null;
  failCount: number;
}

type SmmLogicalKey = "cu" | "lc";

/** Match migration 0036 fingerprint so UI can label canonical vs 0027-replay duplicates. */
export function smmLogicalKey(
  row: Pick<SourceRow, "url" | "fetcherType" | "config">
): SmmLogicalKey | null {
  const config =
    row.config && typeof row.config === "object"
      ? (row.config as Record<string, unknown>)
      : {};
  const metricKeys = Array.isArray(config["metric_keys"])
    ? config["metric_keys"].filter((key): key is string => typeof key === "string")
    : [];
  if (row.url === "https://hq.smm.cn/h5/cu") {
    return "cu";
  }
  if (row.url === "https://hq.smm.cn/h5/Li2CO3") {
    return "lc";
  }
  if (row.fetcherType !== "quotes" || config["adapter"] !== "smm-hq") return null;
  if (metricKeys.includes("cu_main_close")) return "cu";
  if (metricKeys.includes("lc_main_close")) return "lc";
  return null;
}

export function lockedBadgeLabel(row: SourceRow, allRows: SourceRow[]): string | null {
  if (!row.urlLocked) return null;
  const meta = lockedSiblingMeta(row, allRows);
  if (meta.isDuplicate) return "URL锁定·同行副本";
  if (
    meta.canonicalId != null &&
    allRows.some(
      (candidate) =>
        candidate.urlLocked &&
        candidate.id !== row.id &&
        smmLogicalKey(candidate) === smmLogicalKey(row)
    )
  ) {
    return row.enabled ? "URL锁定·当前启用" : "URL锁定·默认行";
  }
  return "URL锁定";
}

export function lockedSiblingMeta(
  row: SourceRow,
  allRows: SourceRow[]
): { isDuplicate: boolean; canonicalId: number | null; siblingEnabled: boolean } {
  if (!row.urlLocked) {
    return { isDuplicate: false, canonicalId: null, siblingEnabled: false };
  }
  const key = smmLogicalKey(row);
  if (!key) {
    return { isDuplicate: false, canonicalId: null, siblingEnabled: false };
  }
  const siblings = allRows.filter(
    (candidate) => candidate.urlLocked && smmLogicalKey(candidate) === key
  );
  if (siblings.length <= 1) {
    return { isDuplicate: false, canonicalId: row.id, siblingEnabled: false };
  }
  const enabledSiblings = siblings.filter((sibling) => sibling.enabled);
  const canonicalId = Math.min(
    ...(enabledSiblings.length > 0 ? enabledSiblings : siblings).map(
      (sibling) => sibling.id
    )
  );
  const siblingEnabled = siblings.some(
    (sibling) => sibling.id !== row.id && sibling.enabled
  );
  return {
    isDuplicate: row.id !== canonicalId,
    canonicalId,
    siblingEnabled
  };
}

export function lockedEnableError(row: SourceRow, allRows: SourceRow[]): string | null {
  return lockedSiblingMeta(row, allRows).siblingEnabled
    ? `同组已有启用的 URL 锁定信源，再启用 #${row.id} 会造成双重抓取。请先停用另一行。`
    : null;
}
