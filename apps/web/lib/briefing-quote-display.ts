/**
 * Pure helpers for copper/lithium briefing detail quote display.
 * Numbers come from commodity_quotes — never invent values.
 */

export const CU_MAIN_METRIC = "cu_main_close";
export const CU_SPOT_METRIC = "cu_spot_smm";
export const CU_CHANGE_METRIC = "cu_change_pct";
export const LC_MAIN_METRIC = "lc_main_close";
export const LC_SPOT_METRIC = "lc_spot_smm";
export const LC_CHANGE_METRIC = "lc_change_pct";

export const BRIEFING_QUOTE_METRIC_KEYS = [
  CU_MAIN_METRIC,
  CU_SPOT_METRIC,
  CU_CHANGE_METRIC,
  LC_MAIN_METRIC,
  LC_SPOT_METRIC,
  LC_CHANGE_METRIC,
] as const;

export type BriefingQuoteMetricKey = (typeof BRIEFING_QUOTE_METRIC_KEYS)[number];

export interface QuoteRow {
  metricKey: string;
  value: string | number | null;
  changePct?: string | number | null;
}

export interface MetalDayQuotes {
  mainClose: number | null;
  spot: number | null;
  changePct: number | null;
}

function toFiniteNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Build a metricKey → numeric value map (last write wins). */
export function indexQuoteValues(rows: QuoteRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const n = toFiniteNumber(row.value);
    if (n !== null) map.set(row.metricKey, n);
  }
  return map;
}

export function pickMetalDayQuotes(
  byKey: Map<string, number>,
  mainKey: string,
  spotKey: string,
  changeKey: string
): MetalDayQuotes {
  return {
    mainClose: byKey.get(mainKey) ?? null,
    spot: byKey.get(spotKey) ?? null,
    changePct: byKey.get(changeKey) ?? null,
  };
}

/** Display price with thousand separators; null → em dash. */
export function formatPriceDisplay(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

/**
 * change_pct is stored as decimal (e.g. -0.0001 → -0.01%).
 * Matches packages/core formatMetricDisplay for *_change_pct keys.
 */
export function formatChangePctDisplay(value: number | null): string | null {
  if (value === null) return null;
  return `${(value * 100).toFixed(2)}%`;
}
