import { dayjs } from "@fe-radar/shared";

export const ZERO_BASE_FALLBACK = 0;

export interface Quote {
  metricKey: string;
  value: number | null;
  changePct: number | null;
  observedAt: Date;
}

export interface TemplateField {
  placeholderKey: string;
  sourceMetric: string | null;
  llmPath: string | null;
  fallbackText: string;
}

export interface SupportResistanceSample {
  high: number;
  low: number;
  close: number;
}

export interface SupportResistanceResult {
  support: number | null;
  resistance: number | null;
}

export interface DegradeResult<T> {
  ok: boolean;
  missing: (keyof T)[];
}

export function computePctChange(prev: number, curr: number): number {
  if (prev === 0) {
    return ZERO_BASE_FALLBACK;
  }
  if (!Number.isFinite(prev) || !Number.isFinite(curr) || Number.isNaN(prev) || Number.isNaN(curr)) {
    return 0;
  }
  return (curr - prev) / prev;
}

/**
 * Derived change_pct metric_key rows (written by quotes-fetch) → parent close metric.
 * Used to fold independent rows back onto close quotes for LLM prompt assembly.
 */
export const DERIVED_CHANGE_PCT_TO_CLOSE: Readonly<Record<string, string>> = {
  cu_change_pct: "cu_main_close",
  lc_change_pct: "lc_main_close",
};

export function isChangePctMetric(metricKey: string): boolean {
  return metricKey.endsWith("_change_pct");
}

/** Format a quote value for docx / template display. change_pct stays decimal in DB; render as "0.67%". */
export function formatMetricDisplay(metricKey: string, value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (isChangePctMetric(metricKey)) {
    return `${(value * 100).toFixed(2)}%`;
  }
  return String(value);
}

/**
 * Merge derived cu_change_pct / lc_change_pct rows into the matching close quote's
 * changePct, then drop the derived rows so they are not listed as standalone metrics.
 */
// ponytail: Map keyed only by metricKey — same-day multi-snapshot last-write-wins; pair by observedAt if force-rerun ever yields multiple observed_at on one calendar day (normal path: single 15:30 cron + deterministic adapter observedAt → ON CONFLICT upsert, no multi-row)
export function mergeDerivedChangePctQuotes(quotes: Quote[]): Quote[] {
  const derivedValues = new Map<string, number | null>();
  for (const q of quotes) {
    const closeKey = DERIVED_CHANGE_PCT_TO_CLOSE[q.metricKey];
    if (closeKey !== undefined) {
      derivedValues.set(closeKey, q.value);
    }
  }

  const merged: Quote[] = [];
  for (const q of quotes) {
    if (DERIVED_CHANGE_PCT_TO_CLOSE[q.metricKey] !== undefined) continue;
    const derived = derivedValues.get(q.metricKey);
    if (derived !== undefined) {
      merged.push({
        ...q,
        changePct: derived,
      });
    } else {
      merged.push(q);
    }
  }
  return merged;
}

export function mapTemplateFields(
  quotes: Quote[],
  templateFields: TemplateField[]
): Record<string, unknown> {
  const quoteByMetric = new Map<string, Quote>();
  for (const quote of quotes) {
    quoteByMetric.set(quote.metricKey, quote);
  }

  const result: Record<string, unknown> = {};
  for (const field of templateFields) {
    if (field.sourceMetric !== null) {
      const quote = quoteByMetric.get(field.sourceMetric);
      const raw = quote?.value ?? null;
      result[field.placeholderKey] = formatMetricDisplay(field.sourceMetric, raw);
    } else {
      result[field.placeholderKey] = null;
    }
  }
  return result;
}

export function isBusinessDay(date: Date | string, holidaySet: Set<string>): boolean {
  const d = dayjs(date).tz("Asia/Shanghai");
  const dow = d.day();
  if (dow === 0 || dow === 6) {
    return false;
  }
  const key = d.format("YYYY-MM-DD");
  return !holidaySet.has(key);
}

// pivot = (H + L + C) / 3 where H/L are range highs/lows and C is most recent close
// support/resistance computed as pivot ± 0.382 × range, clamped by actual close extremes
// (design.md §6.5)
export function computeSupportResistance(
  samples: SupportResistanceSample[]
): SupportResistanceResult {
  const validSamples = samples.filter((sample) =>
    [sample.high, sample.low, sample.close].every((value) => Number.isFinite(value) && value > 0)
  );
  if (validSamples.length < 10) {
    return { support: null, resistance: null };
  }

  const window = validSamples.slice(0, 20);
  const high20 = Math.max(...window.map((s) => s.high));
  const low20 = Math.min(...window.map((s) => s.low));
  const close0 = window[0]!.close;

  const pivot = (high20 + low20 + close0) / 3;
  const range = high20 - low20;

  const closes = window.map((s) => s.close);
  const minClose = Math.min(...closes.slice(1));
  const maxClose = Math.max(...closes.slice(1));

  const rawSupport = pivot - 0.382 * range;
  const rawResistance = pivot + 0.382 * range;

  const support = Math.round(Math.max(minClose, rawSupport));
  const resistance = Math.round(Math.min(maxClose, rawResistance));

  return support <= resistance ? { support, resistance } : { support: null, resistance: null };
}

export function degradeFields<T extends object>(
  payload: T,
  requiredKeys: (keyof T)[]
): DegradeResult<T> {
  const missing = requiredKeys.filter(
    (key) => payload[key] === undefined || payload[key] === null
  );
  return { ok: missing.length === 0, missing };
}
