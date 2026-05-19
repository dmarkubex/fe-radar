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
      result[field.placeholderKey] = quote?.value ?? null;
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
  if (samples.length < 10) {
    return { support: null, resistance: null };
  }

  const window = samples.slice(0, 20);
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

  return { support, resistance };
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
