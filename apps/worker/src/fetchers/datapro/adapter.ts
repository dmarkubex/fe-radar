/**
 * dataPro fetcher adapter — 企业风险 / 财务指标检索
 *
 * 通过 dataPro MCP 搜索接口按批次查询企业风险或财务数据。
 *
 * 约束：
 * - 失败 throw（不返回 []）— dataPro 走通用 fetch handler，空结果会被 markSourceSuccess
 * - query 发送前必经 scrubText 检查；若 level='block' 则跳过该批次（PII 阈值）
 * - 禁止 LLM 抽取数值（直接取 table 键值）
 * - 禁止调 LLM
 * - 每批 ≤ maxStocksPerQuery（默认 3）
 */

import { createHash } from "node:crypto";
import { scrubText, DATAPRO_METRIC_KEY_MAP } from "@fe-radar/core";
import { entities, getDb, upsertEntityFinancials } from "@fe-radar/db";
import type { EntityFinancialInsert } from "@fe-radar/db";
import { createLogger, SourceFetchError } from "@fe-radar/shared";
import { sql } from "drizzle-orm";
import type { FetchContext, StandardItem } from "../types";
import { dataproSearch, type DataproItem } from "./client";
import type {
  DataproAdapter,
  DataproEntity,
  DataproSourceConfig,
} from "./types";

const logger = createLogger({ service: "datapro-adapter" });
const DEFAULT_MAX_STOCKS_PER_QUERY = 3;

const COMPANY_NAME_FIELDS = ["公司名称", "企业名称", "被执行人", "当事人", "公司", "name", "companyName"];
const CASE_NUMBER_FIELDS = ["案号", "caseNumber", "文书号", "案号/文书号"];
const RISK_TYPE_FIELDS = ["风险类型", "风险事项", "type", "riskType"];
const FILING_DATE_FIELDS = ["立案日期", "立案时间", "date", "filingDate"];
const PERIOD_FIELDS = ["报告期", "period", "财报期"];
const REPORT_DATE_FIELDS = ["报告日期", "observedAt", "日期", "reportDate"];
const FINANCIAL_METRIC_KEYS = Object.keys(DATAPRO_METRIC_KEY_MAP);

function hash8(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function pickField(table: Record<string, string>, candidates: string[]): string {
  for (const key of candidates) {
    const value = table[key];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function parseDate(value: string): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function buildRiskQuery(batch: DataproEntity[]): string {
  return `${batch.map((e) => e.name).join(" ")} 司法诉讼 行政处罚 失信 经营异常`;
}

function buildFinancialQuery(batch: DataproEntity[]): string {
  return `${batch.map((e) => e.name).join(" ")} ROE 净利润 营收 营收增速 净利润增速`;
}

function findEntityByCompany(table: Record<string, string>, batch: DataproEntity[]): DataproEntity | null {
  const companyName = pickField(table, COMPANY_NAME_FIELDS);
  if (companyName) {
    const matched = batch.find((e) => companyName.includes(e.name) || e.name.includes(companyName));
    if (matched) return matched;
  }
  for (const entity of batch) {
    for (const value of Object.values(table)) {
      if (value.includes(entity.name)) {
        return entity;
      }
    }
  }
  // P0-3: 不兜底 batch[0] — 无明确公司命中时返回 null，避免风险记录误归属
  return null;
}

function mapRiskItem(item: DataproItem, batch: DataproEntity[]): StandardItem | null {
  const table = item.table;
  const entity = findEntityByCompany(table, batch);
  if (!entity) return null;

  const caseNumber = pickField(table, CASE_NUMBER_FIELDS);
  const riskType = pickField(table, RISK_TYPE_FIELDS) || "风险";
  const filingDate = pickField(table, FILING_DATE_FIELDS);

  const title = `${entity.name} - ${riskType} - ${caseNumber || "无案号"}`;
  const content = Object.entries(table)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const publishedAt = parseDate(filingDate);
  const url = `datapro://risk/${entity.stockCode}/${hash8(title + caseNumber)}`;

  return { url, title, content, publishedAt };
}

function parseNumber(value: string): number | null {
  if (!value || !value.trim()) return null;
  let multiplier = 1;
  let cleaned = value.trim();
  // P1-2: 识别量级后缀并换算，避免 "12.5亿" 和 "12.5万" 都变成 12.5
  if (cleaned.endsWith("亿")) {
    multiplier = 1e8;
    cleaned = cleaned.slice(0, -1);
  } else if (cleaned.endsWith("万")) {
    multiplier = 1e4;
    cleaned = cleaned.slice(0, -1);
  }
  cleaned = cleaned.replace(/[%元,，]/g, "").trim();
  const num = Number(cleaned);
  if (Number.isNaN(num)) return null;
  return num * multiplier;
}

function extractFinancialMetrics(
  table: Record<string, string>,
): Array<{ metric: string; value: number | null }> {
  const records: Array<{ metric: string; value: number | null }> = [];
  for (const key of FINANCIAL_METRIC_KEYS) {
    const raw = table[key];
    if (raw !== undefined) {
      const metricName = DATAPRO_METRIC_KEY_MAP[key] ?? key;
      records.push({ metric: metricName, value: parseNumber(raw) });
    }
  }
  return records;
}

function currentPeriod(): string {
  const now = new Date();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}Q${quarter}`;
}

/**
 * P1-3: 归一化 period 为 YYYYQn 格式，避免 "2024年报" / "2024-Q4" / "2025Q2" 混用
 * 导致 UNIQUE 去重失效和 findLatestMetric 选错期次。
 */
function normalizePeriod(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return currentPeriod();

  // "2025Q2" / "2025q2" → 原样归一化为大写
  const qMatch = trimmed.match(/^(\d{4})[Qq](\d)$/);
  if (qMatch) {
    return `${qMatch[1]}Q${qMatch[2]}`;
  }

  // "2024-Q4" → "2024Q4"
  const dashMatch = trimmed.match(/^(\d{4})-Q?(\d)$/i);
  if (dashMatch) {
    return `${dashMatch[1]}Q${dashMatch[2]}`;
  }

  // "2024年报" / "2024年度" → "2024Q4"
  const yearReportMatch = trimmed.match(/^(\d{4})年报?度?$/);
  if (yearReportMatch) {
    return `${yearReportMatch[1]}Q4`;
  }

  // "2024年中报" → "2024Q2"
  const halfYearMatch = trimmed.match(/^(\d{4})年中报?$/);
  if (halfYearMatch) {
    return `${halfYearMatch[1]}Q2`;
  }

  // "2024年一季度" / "2024年一季" → "2024Q1"
  const cnQuarterMap: Record<string, string> = { "一": "1", "二": "2", "三": "3", "四": "4" };
  const cnQuarterMatch = trimmed.match(/^(\d{4})年([一二三四])季度?$/);
  if (cnQuarterMatch && cnQuarterMatch[2]) {
    const q = cnQuarterMap[cnQuarterMatch[2]];
    if (q) return `${cnQuarterMatch[1]}Q${q}`;
  }

  // 无法识别格式 → 原样返回（至少保持一致性）
  return trimmed;
}

async function resolveEntityIdsByStockCode(stockCodes: string[]): Promise<Map<string, number>> {
  if (stockCodes.length === 0) return new Map();
  const db = getDb();
  const rows = await db
    .select({ id: entities.id, stockCode: sql<string>`meta->>'stockCode'` })
    .from(entities)
    .where(sql`meta->>'stockCode' = ANY(${stockCodes}::text[])`);

  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.stockCode) {
      map.set(row.stockCode, row.id);
    }
  }
  return map;
}

async function processFinancialResults(
  items: DataproItem[],
  batch: DataproEntity[],
): Promise<void> {
  const stockCodes = batch.map((e) => e.stockCode);
  const entityIdMap = await resolveEntityIdsByStockCode(stockCodes);

  const records: EntityFinancialInsert[] = [];
  for (const item of items) {
    const entity = findEntityByCompany(item.table, batch);
    if (!entity) continue;

    const entityId = entityIdMap.get(entity.stockCode);
    if (entityId === undefined) continue;

    const period = normalizePeriod(pickField(item.table, PERIOD_FIELDS) || currentPeriod());
    const reportDate = pickField(item.table, REPORT_DATE_FIELDS);
    const observedAt = reportDate ? parseDate(reportDate) : null;

    const metrics = extractFinancialMetrics(item.table);
    for (const { metric, value } of metrics) {
      records.push({ entityId, metric, value, period, observedAt });
    }
  }

  if (records.length > 0) {
    await upsertEntityFinancials(getDb(), records);
  }
}

async function fetchRisk(
  batches: DataproEntity[][],
  ctx: FetchContext,
): Promise<StandardItem[]> {
  const allItems: StandardItem[] = [];
  let successCount = 0;
  let lastError: unknown;

  for (const batch of batches) {
    const query = buildRiskQuery(batch);

    const scrubbed = scrubText(query);
    if (scrubbed.level === "block") {
      logger.warn({ source: ctx.sourceName }, "datapro risk query blocked by scrubber (PII threshold)");
      continue;
    }

    try {
      const results = await dataproSearch(scrubbed.cleaned);
      const mapped = results
        .map((item) => mapRiskItem(item, batch))
        .filter((item): item is StandardItem => item !== null);
      allItems.push(...mapped);
      successCount += 1;
    } catch (error) {
      logger.warn({ source: ctx.sourceName, error }, "datapro risk batch query failed");
      lastError = error;
    }
  }

  if (successCount === 0) {
    if (lastError) {
      throw new SourceFetchError("FETCH_ALL_QUERIES_FAILED", "所有 dataPro 批次查询均失败", {
        source: ctx.sourceName,
        cause: lastError,
      });
    }
    throw new SourceFetchError("FETCH_ALL_QUERIES_FAILED", "dataPro 查询返回空结果", {
      source: ctx.sourceName,
    });
  }

  // R2-2: 只在 successCount === 0（全部批次真异常）时才 throw；
  // 否则返回已收集的 items（本周期可能无风险记录，合法空结果）。
  return allItems;
}

async function fetchFinancial(
  batches: DataproEntity[][],
  ctx: FetchContext,
): Promise<StandardItem[]> {
  let successCount = 0;
  let lastError: unknown;

  for (const batch of batches) {
    const query = buildFinancialQuery(batch);

    const scrubbed = scrubText(query);
    if (scrubbed.level === "block") {
      logger.warn({ source: ctx.sourceName }, "datapro financial query blocked by scrubber (PII threshold)");
      continue;
    }

    try {
      const results = await dataproSearch(scrubbed.cleaned);
      await processFinancialResults(
        results.map((r) => ({ table: r.table })),
        batch,
      );
      successCount += 1;
    } catch (error) {
      logger.warn({ source: ctx.sourceName, error }, "datapro financial batch query failed");
      lastError = error;
    }
  }

  if (successCount === 0) {
    if (lastError) {
      throw new SourceFetchError("FETCH_ALL_QUERIES_FAILED", "所有 dataPro 批次查询均失败", {
        source: ctx.sourceName,
        cause: lastError,
      });
    }
    throw new SourceFetchError("FETCH_ALL_QUERIES_FAILED", "dataPro 查询返回空结果", {
      source: ctx.sourceName,
    });
  }

  // R2-2: successCount > 0 即视为成功（本周期可能无财务更新，合法空结果），返回 []。
  return [];
}

export const dataproAdapter: DataproAdapter = {
  name: "datapro",

  async fetch(config: DataproSourceConfig, ctx: FetchContext): Promise<StandardItem[]> {
    const maxPerQuery = config.maxStocksPerQuery ?? DEFAULT_MAX_STOCKS_PER_QUERY;
    const batches = chunk(config.entities, maxPerQuery);

    if (batches.length === 0) {
      throw new SourceFetchError("FETCH_CONFIG", "datapro source requires non-empty entities array", {
        source: ctx.sourceName,
      });
    }

    if (config.dataType === "risk") {
      return fetchRisk(batches, ctx);
    }

    return fetchFinancial(batches, ctx);
  },
};
