import { fetchTextWithPolicy } from "../http";
import type { FetchContext } from "../types";
import type { QuotesAdapter, QuoteSample } from "./types";

interface SmmHqMetricRule {
  metric_key: string;
  emit_metric_keys?: string[];
  kind?: "product" | "instrument";
  column_no?: string;
  product_id?: string;
  product_name?: string;
  product_names?: string[];
  instrument_id?: string;
  typename?: string;
  value_field?: string;
}

interface SmmHqConfig {
  endpoint?: string;
  metric_keys?: string[];
  items?: SmmHqMetricRule[];
}

type UnknownRecord = Record<string, unknown>;

function stripAndTruncate(input: string): string {
  const text = input.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const codePoints = Array.from(text);
  return codePoints.length > 2000 ? codePoints.slice(0, 2000).join("") : text;
}

function recordRawText(record: UnknownRecord): string {
  return stripAndTruncate(JSON.stringify(record));
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/,/g, "").trim();
  if (normalized.length === 0) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, "").toLowerCase() : "";
}

function parseShanghaiDate(date: unknown, time: unknown, fallback: Date): Date {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return fallback;
  }
  const timePart =
    typeof time === "string" && /^\d{2}:\d{2}(?::\d{2})?$/.test(time)
      ? time.length === 5 ? `${time}:00` : time
      : "15:30:00";
  return new Date(`${date}T${timePart}+08:00`);
}

function parseProductObservedAt(record: UnknownRecord): Date | null {
  const date = record["renew_date"];
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const [year, month, day] = date.split("-").map(Number);
  const calendarCheck = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    calendarCheck.getUTCFullYear() !== year
    || calendarCheck.getUTCMonth() !== month! - 1
    || calendarCheck.getUTCDate() !== day
  ) return null;

  const observedAt = parseShanghaiDate(date, record["renew_time"], new Date(Number.NaN));
  return Number.isFinite(observedAt.getTime()) ? observedAt : null;
}

function extractNextData(html: string): unknown | null {
  const match = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!match?.[1]) return null;
  return JSON.parse(match[1]) as unknown;
}

function valueAtPath(root: unknown, path: string[]): unknown {
  let current = root;
  for (const segment of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as UnknownRecord)[segment];
  }
  return current;
}

function flattenRecords(root: unknown, predicate: (record: UnknownRecord) => boolean): UnknownRecord[] {
  const results: UnknownRecord[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as UnknownRecord;
    if (predicate(record)) results.push(record);
    for (const child of Object.values(record)) visit(child);
  };
  visit(root);
  return results;
}

function datasRoot(nextData: unknown): unknown {
  return valueAtPath(nextData, ["props", "pageProps", "datas"]);
}

function candidateRoot(datas: unknown, rule: SmmHqMetricRule): unknown {
  if (!rule.column_no || !datas || typeof datas !== "object") return datas;
  return (datas as UnknownRecord)[rule.column_no];
}

function positiveValue(record: UnknownRecord, field: string): number | null {
  const value = parseNumber(record[field]);
  return value !== null && value > 0 ? value : null;
}

function findProductRecord(
  datas: unknown,
  rule: SmmHqMetricRule,
  now: Date
): UnknownRecord | undefined {
  const productNames = [rule.product_name, ...(rule.product_names ?? [])]
    .map(normalizeName)
    .filter(Boolean);
  const searchRoot = rule.product_id ? datas : candidateRoot(datas, rule);
  const matches = flattenRecords(searchRoot, (record) => "product_name" in record)
    .filter((record) => {
      if (rule.product_id) return record["product_id"] === rule.product_id;
      const productName = normalizeName(record["product_name"]);
      return productNames.some((name) => productName === name);
    });
  const valueField = rule.value_field ?? "average";
  const latest = (records: UnknownRecord[]): UnknownRecord | undefined => records
    .map((record) => ({ record, observedAt: parseProductObservedAt(record) }))
    .filter((candidate): candidate is { record: UnknownRecord; observedAt: Date } =>
      candidate.observedAt !== null
      && candidate.observedAt <= now
      && positiveValue(candidate.record, valueField) !== null
    )
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0]?.record;

  const candidates = matches.filter((record) => record["hide_data"] !== true);
  for (const parent of matches) {
    if (!Array.isArray(parent["price_detail"])) continue;
    for (const detail of parent["price_detail"]) {
      if (!detail || typeof detail !== "object") continue;
      const candidate = detail as UnknownRecord;
      if (rule.product_id && candidate["product_id"] != null
        && candidate["product_id"] !== rule.product_id) continue;
      candidates.push({ ...parent, ...candidate });
    }
  }
  return latest(candidates);
}

function findInstrumentRecord(datas: unknown, rule: SmmHqMetricRule): UnknownRecord | undefined {
  const targetInstrument = normalizeName(rule.instrument_id);
  const targetTypeName = normalizeName(rule.typename);
  return flattenRecords(candidateRoot(datas, rule), (record) => "InstrumentID" in record || "Typename" in record)
    .find((record) => {
      const instrumentId = normalizeName(record["InstrumentID"]);
      const typeName = normalizeName(record["Typename"]);
      return Boolean(
        (targetInstrument && instrumentId === targetInstrument) ||
        (targetTypeName && typeName === targetTypeName)
      );
    });
}

function metricKeysFor(rule: SmmHqMetricRule): string[] {
  return Array.from(new Set([rule.metric_key, ...(rule.emit_metric_keys ?? [])].filter(Boolean)));
}

function nullSamples(metricKeys: string[], observedAt: Date, rawText: string): QuoteSample[] {
  return metricKeys.map((metricKey) => ({ metricKey, value: null, observedAt, rawText }));
}

function samplesFromRecord(rule: SmmHqMetricRule, record: UnknownRecord, now: Date): QuoteSample[] {
  const isInstrument = rule.kind === "instrument";
  const valueField = rule.value_field ?? (isInstrument ? "LastPrice" : "average");
  const value = positiveValue(record, valueField);
  const observedAt = isInstrument
    ? parseShanghaiDate(record["TradingDay"] ?? record["ActionDay"], record["UpdateTime"], now)
    : parseShanghaiDate(record["renew_date"], record["renew_time"], now);
  const rawText = recordRawText(record);
  return metricKeysFor(rule).map((metricKey) => ({
    metricKey,
    value,
    observedAt,
    rawText,
    sourceMetadata: {
      source: "SMM",
      kind: rule.kind ?? "product",
      columnNo: rule.column_no,
      productId: record["product_id"],
      productName: record["product_name"],
      instrumentId: record["InstrumentID"],
      typeName: record["Typename"],
      valueField,
    },
  }));
}

function fallbackMetricKeys(config: SmmHqConfig): string[] {
  if (Array.isArray(config.metric_keys) && config.metric_keys.length > 0) {
    return config.metric_keys;
  }
  return ["unknown"];
}

async function fetchSmmHq(
  ctx: FetchContext,
  now: Date = new Date(),
  fetchImpl?: typeof fetch
): Promise<QuoteSample[]> {
  const config = (ctx.sourceConfig ?? {}) as SmmHqConfig;
  if (!config.endpoint) return [];

  let html: string;
  try {
    html = await fetchTextWithPolicy(config.endpoint, {
      timeoutMs: 10000,
      useRealUa: ctx.useRealUa ?? true,
      source: ctx.sourceName,
      fetchImpl,
    });
  } catch {
    return [];
  }

  const htmlRawText = stripAndTruncate(html);
  let nextData: unknown | null;
  try {
    nextData = extractNextData(html);
  } catch {
    return nullSamples(fallbackMetricKeys(config), now, htmlRawText);
  }

  const rules = config.items ?? [];
  const parsedRawText = nextData ? stripAndTruncate(JSON.stringify(nextData)) : "";
  const missRawText = parsedRawText || htmlRawText || "SMM page contained no extractable text";
  if (!nextData || rules.length === 0) {
    return nullSamples(fallbackMetricKeys(config), now, missRawText);
  }

  const datas = datasRoot(nextData);
  const samples: QuoteSample[] = [];
  for (const rule of rules) {
    const record = rule.kind === "instrument"
      ? findInstrumentRecord(datas, rule)
      : findProductRecord(datas, rule, now);
    if (!record) {
      samples.push(...nullSamples(metricKeysFor(rule), now, missRawText));
      continue;
    }
    samples.push(...samplesFromRecord(rule, record, now));
  }
  return samples;
}

export const smmHqAdapter: QuotesAdapter = {
  name: "smm-hq",
  fetch: (ctx: FetchContext) => fetchSmmHq(ctx),
};

export { fetchSmmHq };
