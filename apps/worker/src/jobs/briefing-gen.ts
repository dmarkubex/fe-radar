/**
 * briefing-gen job — T-CB-13
 *
 * 5 步 + step 3.5 pipeline (design.md §5.2):
 *   Step 0  precheck: quotes-fetch queue 陈旧度（v0.4 fix E1）
 *   Step 1  field precheck: 当日字段覆盖率
 *   Step 2  context assembly: buildBriefingInput
 *   Step 3  LLM 7 段: runBriefingGen via withScrubber
 *   Step 3.5 inject s/r: computeSupportResistance → merge into payload_json
 *   Step 4  docx render: renderBriefing → MinIO
 *   Step 5  persist: INSERT INTO commodity_briefings
 */

import { and, desc, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import { Queue } from "bullmq";

import {
  briefingHolidays,
  commodityBriefings,
  commodityQuotes,
  getDb,
  itemAnalysis,
  items,
  sources,
} from "@fe-radar/db";
import type { DbClient } from "@fe-radar/db";
import {
  computeSupportResistance,
  degradeFields,
  formatMetricDisplay,
  isBusinessDay,
} from "@fe-radar/core";
import type { Quote, SupportResistanceSample } from "@fe-radar/core";
import {
  buildBriefingInput,
  runBriefingGen as llmRunBriefingGen,
} from "@fe-radar/llm";
import type { BriefingOutput, NewsItem, PreviousBriefingContext } from "@fe-radar/llm";
import { APP_TIMEZONE, createLogger, dayjs } from "@fe-radar/shared";

import { renderBriefing } from "../lib/briefing-render";
import { BRIEFING_TEMPLATE_VERSION } from "../lib/briefing-constants";
import { createRedisConnection, QUEUE_QUOTES_FETCH } from "../queues";
import { loadProjectCodes } from "../handlers/context";

const logger = createLogger({ service: "briefing-gen" });

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Minimum number of key metric fields required to proceed without degraded status */
const MIN_KEY_FIELDS = 5;

/** Delay between precheck retries (ms) */
const PRECHECK_RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

/** Maximum number of queue-empty retries before aborting */
const MAX_QUEUE_RETRIES = 2;

/** Maximum number of field-coverage retries before degraded */
const MAX_FIELD_RETRIES = 2;

/**
 * Key metric fields required for a non-degraded briefing.
 *
 * IMPORTANT (Antigravity #3): these MUST match the canonical metric_key values
 * actually produced by the quotes adapters / seeded in
 * 0009_commodity_seed.sql (sources.config.metric_keys + briefing_template_fields.
 * source_metric). The earlier values cu_main_change_pct / lc_main_change_pct /
 * usd_cny never existed in commodity_quotes, so every briefing was falsely
 * judged coverage-insufficient → degraded. See drift-guard test in
 * briefing-gen.test.ts.
 */
export const KEY_METRIC_FIELDS = [
  "cu_main_close", // SHFE 沪铜主力收盘
  "cu_change_pct", // SHFE 沪铜涨跌幅
  "lc_main_close", // GFEX 碳酸锂主力收盘
  "lc_change_pct", // GFEX 碳酸锂涨跌幅
  "fx_usdcny", // USD/CNY 日度参考汇率
];

const POSITIVE_VALUE_METRICS = new Set([
  "cu_main_close",
  "cu_spot_smm",
  "lc_main_close",
  "lc_spot_smm",
  "fx_usdcny",
]);

// ─────────────────────────────────────────────────────────────
// Result type
// ─────────────────────────────────────────────────────────────

export type BriefingGenStatus = "succeeded" | "degraded" | "failed" | "skipped";

export interface BriefingGenResult {
  status: BriefingGenStatus;
  briefingId?: number;
  docxPath?: string;
  genError?: string;
}

// ─────────────────────────────────────────────────────────────
// Extended payload type (LLM output + injected s/r)
// ─────────────────────────────────────────────────────────────

interface OutlookWithSR {
  trend: string;
  support: number | null;
  resistance: number | null;
}

interface BriefingPayloadJson extends BriefingOutput {
  cu: BriefingOutput["cu"] & { outlook: OutlookWithSR };
  lc: BriefingOutput["lc"] & { outlook: OutlookWithSR };
  _srDegraded?: boolean; // true when sample < 10
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function loadHolidaySet(db: DbClient): Promise<Set<string>> {
  const rows = await db
    .select({ holidayDate: briefingHolidays.holidayDate })
    .from(briefingHolidays);
  return new Set(rows.map((r) => r.holidayDate as string));
}

async function queryTodayQuotes(db: DbClient, todayStr: string): Promise<Quote[]> {
  const rows = await db
    .select({
      metricKey: commodityQuotes.metricKey,
      value: commodityQuotes.value,
      changePct: commodityQuotes.changePct,
      observedAt: commodityQuotes.observedAt,
    })
    .from(commodityQuotes)
    .where(sql`DATE(${commodityQuotes.observedAt} AT TIME ZONE 'Asia/Shanghai') = ${todayStr}::date`);

  return rows.map((r) => {
    const parsed = r.value !== null ? Number(r.value) : null;
    const value = parsed !== null && Number.isFinite(parsed)
      && (!POSITIVE_VALUE_METRICS.has(r.metricKey) || parsed > 0)
      ? parsed
      : null;
    return {
      metricKey: r.metricKey,
      value,
      changePct: r.changePct !== null ? Number(r.changePct) : null,
      observedAt: r.observedAt,
    };
  });
}

async function queryRecentQuotes(
  db: DbClient,
  metricKey: string,
  limit: number
): Promise<Quote[]> {
  const rows = await db
    .select({
      metricKey: commodityQuotes.metricKey,
      value: commodityQuotes.value,
      changePct: commodityQuotes.changePct,
      observedAt: commodityQuotes.observedAt,
    })
    .from(commodityQuotes)
    .where(
      and(
        eq(commodityQuotes.metricKey, metricKey),
        isNotNull(commodityQuotes.value)
      )
    )
    .orderBy(desc(commodityQuotes.observedAt))
    .limit(limit);

  return rows.map((r) => ({
    metricKey: r.metricKey,
    value: r.value !== null ? Number(r.value) : null,
    changePct: r.changePct !== null ? Number(r.changePct) : null,
    observedAt: r.observedAt,
  }));
}

/** Build SupportResistanceSample[] from a sequence of close-price quotes.
 *  Since commodity_quotes only stores close + changePct, we approximate
 *  high/low as close ± 0 (only close available), which degrades gracefully.
 *  When the high/low series is unavailable we use close for all three fields.
 */
function quotesToSRSamples(quotes: Quote[]): SupportResistanceSample[] {
  return quotes
    .filter((q) => q.value !== null && Number.isFinite(q.value) && q.value > 0)
    .map((q) => ({
      high: q.value as number,
      low: q.value as number,
      close: q.value as number,
    }));
}

async function queryPreviousBriefing(
  db: DbClient,
  todayStr: string
): Promise<PreviousBriefingContext | null> {
  const [row] = await db
    .select({
      date: commodityBriefings.briefingDate,
      cuLogic: sql<string>`${commodityBriefings.payloadJson} #>> '{cu,logic_summary}'`,
      cuTrend: sql<string>`${commodityBriefings.payloadJson} #>> '{cu,outlook,trend}'`,
      lcLogic: sql<string>`${commodityBriefings.payloadJson} #>> '{lc,logic_summary}'`,
      lcTrend: sql<string>`${commodityBriefings.payloadJson} #>> '{lc,outlook,trend}'`,
      macroSummary: sql<string>`${commodityBriefings.payloadJson} ->> 'macro_summary'`,
      procurementAdvice: sql<string>`${commodityBriefings.payloadJson} ->> 'procurement_advice'`,
    })
    .from(commodityBriefings)
    .where(and(
      lt(commodityBriefings.briefingDate, todayStr),
      sql`${commodityBriefings.genStatus} IN ('succeeded', 'degraded')`
    ))
    .orderBy(desc(commodityBriefings.briefingDate))
    .limit(1);

  if (!row?.cuLogic || !row.cuTrend || !row.lcLogic || !row.lcTrend
    || !row.macroSummary || !row.procurementAdvice) return null;
  return row as PreviousBriefingContext;
}

async function queryContextNews(db: DbClient, since: Date): Promise<NewsItem[]> {
  const rows = await db
    .select({
      title: items.title,
      summaryZh: itemAnalysis.summaryZh,
      publishedAt: items.publishedAt,
      category: itemAnalysis.category,
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .innerJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id))
    .where(
      and(
        gte(items.publishedAt, since),
        isNotNull(itemAnalysis.summaryZh),
        ne(itemAnalysis.summaryZh, "")
      )
    )
    .orderBy(sql`${itemAnalysis.qualityScore} DESC NULLS LAST`)
    .limit(30);

  return rows
    .filter((r) => r.summaryZh !== null && r.publishedAt !== null)
    .map((r) => ({
      title: r.title,
      summaryZh: r.summaryZh as string,
      publishedAt: r.publishedAt as Date,
      category: r.category ?? undefined,
    }));
}

/** Sleep helper (used for retry delays in tests via injection) */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────
// Main job function
// ─────────────────────────────────────────────────────────────

export interface BriefingGenOptions {
  db?: DbClient;
  now?: Date;
  /** Inject a mock Queue for testing step 0 (quotes-fetch queue check) */
  quotesFetchQueueOverride?: {
    getJobCounts(...states: string[]): Promise<Record<string, number>>;
    getJobs?(states: ["delayed"]): Promise<Array<{ name: string; data?: { sourceId?: number } }>>;
  };
  /** Override sleep delay for testing (set to 0) */
  retryDelayMs?: number;
  /** If true: skip duplicate-check and upsert (overwrite) existing row on persist */
  force?: boolean;
}

export async function runBriefingGen(
  options: BriefingGenOptions = {}
): Promise<BriefingGenResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const retryDelayMs = options.retryDelayMs ?? PRECHECK_RETRY_DELAY_MS;
  const nowDayjs = dayjs(now).tz(APP_TIMEZONE);
  const todayStr = nowDayjs.format("YYYY-MM-DD");
  const briefingDateKey = todayStr; // DATE column value

  // ── Holiday check ──────────────────────────────────────────
  const holidaySet = await loadHolidaySet(db);
  if (!isBusinessDay(now, holidaySet)) {
    logger.info({ todayStr }, "briefing-gen skipped: not a business day");
    return { status: "skipped" };
  }

  // ── Duplicate check (skipped when force=true) ──────────────
  if (!options.force) {
    const [existing] = await db
      .select({ id: commodityBriefings.id, docxPath: commodityBriefings.docxPath })
      .from(commodityBriefings)
      .where(eq(commodityBriefings.briefingDate, briefingDateKey))
      .limit(1);

    if (existing) {
      logger.info({ briefingDate: todayStr, briefingId: existing.id }, "briefing-gen skipped: already generated for today");
      return {
        status: "succeeded",
        briefingId: existing.id,
        docxPath: existing.docxPath ?? undefined,
      };
    }
  }

  // ── Step 0: quotes-fetch queue precheck (v0.4 fix E1) ─────
  // Create the queue handle ONCE (not per retry) and always close it. Tests
  // inject quotesFetchQueueOverride, in which case we own no Redis resource.
  const ownPrecheckConn = options.quotesFetchQueueOverride ? null : createRedisConnection();
  const ownPrecheckQueue = ownPrecheckConn
    ? new Queue(QUEUE_QUOTES_FETCH, { connection: ownPrecheckConn })
    : null;
  const queueHandle = options.quotesFetchQueueOverride ?? ownPrecheckQueue!;
  try {
    let queueRetries = 0;
    while (true) {
      const counts = await queueHandle.getJobCounts("waiting", "active", "delayed");
      const delayedJobs = options.quotesFetchQueueOverride
        ? options.quotesFetchQueueOverride.getJobs
          ? await options.quotesFetchQueueOverride.getJobs(["delayed"])
          : []
        : await ownPrecheckQueue!.getJobs(["delayed"]);
      const scheduledRuns = delayedJobs.filter(
        (job) => job.name === "schedule-quotes-fetch" && job.data?.sourceId === 0
      ).length;
      const pending =
        (counts["waiting"] ?? 0) +
        (counts["active"] ?? 0) +
        Math.max(0, (counts["delayed"] ?? 0) - scheduledRuns);

      if (pending === 0) break; // quotes-fetch queue is clear

      queueRetries++;
      if (queueRetries > MAX_QUEUE_RETRIES) {
        logger.error(
          { counts, retries: queueRetries },
          "briefing-gen aborted: quotes-fetch queue still non-empty after max retries"
        );
        await persistBriefing(db, todayStr, {}, null, "failed", "quotes-fetch queue non-empty after max retries", options.force);
        return {
          status: "failed",
          genError: "quotes-fetch queue non-empty after max retries",
        };
      }

      logger.warn(
        { counts, attempt: queueRetries },
        `briefing-gen: quotes-fetch queue non-empty, waiting ${retryDelayMs}ms before retry`
      );
      await sleep(retryDelayMs);
    }
  } finally {
    if (ownPrecheckQueue) await ownPrecheckQueue.close();
    if (ownPrecheckConn) await ownPrecheckConn.quit();
  }

  // ── Step 1: field coverage precheck ───────────────────────
  let fieldRetries = 0;
  let todayQuotes: Quote[] = [];

  while (true) {
    todayQuotes = await queryTodayQuotes(db, todayStr);
    const presentKeys = new Set(todayQuotes.filter((q) => q.value !== null).map((q) => q.metricKey));
    const rawCoverage = KEY_METRIC_FIELDS.filter((k) => presentKeys.has(k));

    if (rawCoverage.length >= MIN_KEY_FIELDS) break;

    fieldRetries++;
    if (fieldRetries > MAX_FIELD_RETRIES) {
      logger.warn(
        { coverage: rawCoverage.length, required: MIN_KEY_FIELDS, briefingDate: todayStr },
        "briefing-gen: insufficient field coverage after retries, proceeding as degraded"
      );
      break;
    }

    logger.warn(
      { coverage: rawCoverage.length, required: MIN_KEY_FIELDS, attempt: fieldRetries },
      `briefing-gen: field coverage insufficient, waiting ${retryDelayMs}ms`
    );
    await sleep(retryDelayMs);
  }

  // Use degradeFields (packages/core) as the authoritative coverage check.
  // This allows tests to control the degraded/ok decision via mocking.
  const quotesByKey: Record<string, number | null> = {};
  for (const q of todayQuotes) {
    quotesByKey[q.metricKey] = q.value;
  }
  const coveragePayload = Object.fromEntries(
    KEY_METRIC_FIELDS.map((k) => [k, quotesByKey[k] ?? null])
  ) as Record<(typeof KEY_METRIC_FIELDS)[number], number | null>;
  const degrade = degradeFields(coveragePayload, KEY_METRIC_FIELDS as unknown as (keyof typeof coveragePayload)[]);
  const isDegraded = !degrade.ok;

  // ── Step 2: context assembly ───────────────────────────────
  const since24h = nowDayjs.subtract(24, "hour").toDate();
  const contextNews = await queryContextNews(db, since24h);
  const previousBriefing = await queryPreviousBriefing(db, todayStr);

  const briefingInput = buildBriefingInput(todayQuotes, contextNews, undefined, previousBriefing);

  // ── Step 3: LLM 7-segment generation ──────────────────────
  let llmOutput: BriefingOutput;
  try {
    // T-SEC-09: 注入项目代号字典。
    const projectCodes = await loadProjectCodes();
    const result = await llmRunBriefingGen(briefingInput, projectCodes);
    llmOutput = result.value;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error, briefingDate: todayStr }, "briefing-gen: LLM generation failed");
    await persistBriefing(db, todayStr, {}, null, "failed", errMsg, options.force);
    return { status: "failed", genError: errMsg };
  }

  // ── Step 3.5: inject support/resistance ───────────────────
  const cuSamples20 = await queryRecentQuotes(db, "cu_main_close", 20);
  const lcSamples20 = await queryRecentQuotes(db, "lc_main_close", 20);

  const cuSR = computeSupportResistance(quotesToSRSamples(cuSamples20));
  const lcSR = computeSupportResistance(quotesToSRSamples(lcSamples20));

  const srDegraded = cuSR.support === null || lcSR.support === null;

  const payloadJson: BriefingPayloadJson = {
    ...llmOutput,
    cu: {
      ...llmOutput.cu,
      outlook: {
        ...llmOutput.cu.outlook,
        support: cuSR.support,
        resistance: cuSR.resistance,
      },
    },
    lc: {
      ...llmOutput.lc,
      outlook: {
        ...llmOutput.lc.outlook,
        support: lcSR.support,
        resistance: lcSR.resistance,
      },
    },
    ...(srDegraded ? { _srDegraded: true } : {}),
  };

  if (srDegraded) {
    logger.warn(
      { cuSamples: cuSamples20.length, lcSamples: lcSamples20.length },
      "briefing-gen step 3.5: s/r degraded (sample < 10), support/resistance set to null"
    );
  }

  // ── Step 4: docx render ───────────────────────────────────
  const briefingDateCompact = todayStr.replace(/-/g, ""); // YYYYMMDD

  // Build flat template fields from payload + today's quotes
  const templateFields = buildTemplateFields(payloadJson, quotesByKey, todayStr, now);

  let docxPath: string | null = null;
  try {
    const renderResult = await renderBriefing(
      { briefingDate: briefingDateCompact, fields: templateFields },
      db
    );
    docxPath = renderResult.docxPath;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error, briefingDate: todayStr }, "briefing-gen: docx render failed");
    await persistBriefing(db, todayStr, payloadJson, null, "failed", errMsg, options.force);
    return { status: "failed", genError: errMsg };
  }

  // ── Step 5: persist ───────────────────────────────────────
  const finalStatus = isDegraded ? "degraded" : "succeeded";
  const briefingId = await persistBriefing(
    db,
    todayStr,
    payloadJson,
    docxPath,
    finalStatus,
    null,
    options.force
  );

  // T-DUP-02: do not auto-enqueue a standalone briefing push after generation.
  // Merged daily push is driven by daily_push_config + minute tick; manual
  // admin "repush" still enqueues runBriefingPush via /api/briefing/:id/repush.

  logger.info(
    { briefingId, briefingDate: todayStr, status: finalStatus, docxPath },
    "briefing-gen completed"
  );

  return { status: finalStatus, briefingId, docxPath: docxPath ?? undefined };
}

// ─────────────────────────────────────────────────────────────
// Persist helper
// ─────────────────────────────────────────────────────────────

async function persistBriefing(
  db: DbClient,
  briefingDate: string,
  payloadJson: object,
  docxPath: string | null,
  genStatus: "succeeded" | "degraded" | "failed",
  genError: string | null,
  force?: boolean
): Promise<number> {
  const values = {
    briefingDate,
    templateVersion: BRIEFING_TEMPLATE_VERSION,
    payloadJson,
    docxPath,
    genStatus,
    genError,
    generatedAt: new Date(),
  };

  if (force) {
    // Force-regenerate: upsert to overwrite any existing row for this date.
    const [row] = await db
      .insert(commodityBriefings)
      .values(values)
      .onConflictDoUpdate({
        target: commodityBriefings.briefingDate,
        set: {
          templateVersion: BRIEFING_TEMPLATE_VERSION,
          payloadJson,
          docxPath,
          genStatus,
          genError,
          generatedAt: new Date(),
        },
      })
      .returning({ id: commodityBriefings.id });
    return row?.id ?? 0;
  }

  // Normal path: idempotent insert (do nothing on conflict).
  const [row] = await db
    .insert(commodityBriefings)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: commodityBriefings.id });

  // If onConflictDoNothing fired (race condition: another worker already inserted),
  // fetch the existing row's id.
  if (!row) {
    const [existing] = await db
      .select({ id: commodityBriefings.id })
      .from(commodityBriefings)
      .where(eq(commodityBriefings.briefingDate, briefingDate))
      .limit(1);
    return existing?.id ?? 0;
  }

  return row.id;
}

// ─────────────────────────────────────────────────────────────
// Template field builder
// ─────────────────────────────────────────────────────────────

/**
 * Maps flat docx placeholder keys → commodity_quotes metric_key, mirroring the
 * `source_metric` column seeded in 0009_commodity_seed.sql. Keeping this in sync
 * with the seed is what lets the docx template (flat {{cu_close}} placeholders)
 * resolve real numeric values. Any key absent from today's quotes falls back to
 * "—" via the template nullGetter.
 */
const PLACEHOLDER_METRIC_MAP: Record<string, string> = {
  cu_close: "cu_main_close",
  cu_open: "cu_main_open",
  cu_high: "cu_main_high",
  cu_low: "cu_main_low",
  cu_volume: "cu_main_volume",
  cu_change_pct: "cu_change_pct",
  cu_warrants: "cu_warrants",
  lc_close: "lc_main_close",
  lc_open: "lc_main_open",
  lc_high: "lc_main_high",
  lc_low: "lc_main_low",
  lc_volume: "lc_main_volume",
  lc_change_pct: "lc_change_pct",
  lc_warrants: "lc_warrants",
  lme_cu_close: "lme_cu_3m",
  lme_cu_cash: "lme_cu_cash",
  lme_cu_change_pct: "lme_cu_change_pct",
  fx_usdcny: "fx_usdcny",
  fx_eurcny: "fx_eurcny",
  fx_hkdcny: "fx_hkdcny",
  cny_10y_yield: "cny_10y_yield",
  cny_5y_yield: "cny_5y_yield",
  cny_2y_yield: "cny_2y_yield",
  cu_spot_smm: "cu_spot_smm",
  cu_spot_100ppi: "cu_spot_100ppi",
  cu_spot_cjsc: "cu_spot_cjsc",
  lc_spot_smm: "lc_spot_smm",
  ev_sales_monthly: "ev_sales_monthly",
  al_spot_smm: "al_spot_smm",
  zn_spot_smm: "zn_spot_smm",
};

/**
 * Assemble the flat placeholder→value map consumed by the docx template. Keys
 * MUST match `briefing_template_fields.placeholder_key` (flat, e.g. `cu_close`,
 * `cu_logic_summary`) so the render-time lint passes and values actually
 * substitute. LLM segments + code-computed support/resistance come from
 * payload_json; numeric metrics come from today's quotes via
 * PLACEHOLDER_METRIC_MAP; static/meta fields are filled inline.
 */
function buildTemplateFields(
  payload: BriefingPayloadJson,
  quotesByKey: Record<string, number | null>,
  briefingDate: string,
  now: Date
): Record<string, string> {
  const fallback = "—";

  function fmt(v: number | null | undefined): string {
    if (v === null || v === undefined) return fallback;
    return String(v);
  }

  /** Metric display: *_change_pct → "0.67%"; other numerics as plain string. */
  function fmtMetric(metricKey: string, v: number | null | undefined): string {
    return formatMetricDisplay(metricKey, v) ?? fallback;
  }

  const fields: Record<string, string> = {
    // Static / meta
    briefing_date: briefingDate,
    template_version: String(BRIEFING_TEMPLATE_VERSION),
    generated_at: dayjs(now).tz(APP_TIMEZONE).format("YYYY-MM-DD HH:mm"),
    report_disclaimer: "本简报仅供远东控股内部参考，不构成投资建议。",
    footer_date: briefingDate,
    footer_company: "远东控股集团",
    // LLM 7-segment output
    cu_logic_summary: payload.cu.logic_summary ?? fallback,
    cu_outlook_trend: payload.cu.outlook.trend ?? fallback,
    lc_logic_summary: payload.lc.logic_summary ?? fallback,
    lc_outlook_trend: payload.lc.outlook.trend ?? fallback,
    macro_summary: payload.macro_summary ?? fallback,
    risk_notes: Array.isArray(payload.risk_notes)
      ? payload.risk_notes.join("；")
      : fallback,
    procurement_advice: payload.procurement_advice ?? fallback,
    // Code-computed support / resistance (design.md §6.5)
    cu_support: fmt(payload.cu.outlook.support),
    cu_resistance: fmt(payload.cu.outlook.resistance),
    lc_support: fmt(payload.lc.outlook.support),
    lc_resistance: fmt(payload.lc.outlook.resistance),
  };

  // Numeric metric placeholders (NFR-102: values come only from quotes, never LLM)
  for (const [placeholder, metricKey] of Object.entries(PLACEHOLDER_METRIC_MAP)) {
    fields[placeholder] = fmtMetric(metricKey, quotesByKey[metricKey]);
  }

  return fields;
}
