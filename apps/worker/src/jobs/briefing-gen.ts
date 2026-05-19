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

import { and, desc, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
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
import { buildBriefingInput, runBriefingGen as llmRunBriefingGen } from "@fe-radar/llm";
import type { BriefingOutput, NewsItem } from "@fe-radar/llm";
import {
  computeSupportResistance,
  degradeFields,
  isBusinessDay,
} from "@fe-radar/core";
import type { Quote, SupportResistanceSample } from "@fe-radar/core";
import { APP_TIMEZONE, createLogger, dayjs } from "@fe-radar/shared";

import { renderBriefing } from "../lib/briefing-render";
import { createRedisConnection, QUEUE_QUOTES_FETCH } from "../queues";

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

/** Key metric fields required for a non-degraded briefing (first 5 from commodity_quotes) */
const KEY_METRIC_FIELDS = [
  "cu_main_close",
  "cu_main_change_pct",
  "lc_main_close",
  "lc_main_change_pct",
  "usd_cny",
];

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

  return rows.map((r) => ({
    metricKey: r.metricKey,
    value: r.value !== null ? Number(r.value) : null,
    changePct: r.changePct !== null ? Number(r.changePct) : null,
    observedAt: r.observedAt,
  }));
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
    .filter((q) => q.value !== null)
    .map((q) => ({
      high: q.value as number,
      low: q.value as number,
      close: q.value as number,
    }));
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
  };
  /** Override sleep delay for testing (set to 0) */
  retryDelayMs?: number;
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

  // ── Duplicate check ────────────────────────────────────────
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

  // ── Step 0: quotes-fetch queue precheck (v0.4 fix E1) ─────
  let queueRetries = 0;
  while (true) {
    const queueHandle =
      options.quotesFetchQueueOverride ??
      new Queue(QUEUE_QUOTES_FETCH, { connection: createRedisConnection() });

    const counts = await queueHandle.getJobCounts("waiting", "active", "delayed");
    const pending = (counts["waiting"] ?? 0) + (counts["active"] ?? 0) + (counts["delayed"] ?? 0);

    if (pending === 0) break; // quotes-fetch queue is clear

    queueRetries++;
    if (queueRetries > MAX_QUEUE_RETRIES) {
      logger.error(
        { counts, retries: queueRetries },
        "briefing-gen aborted: quotes-fetch queue still non-empty after max retries"
      );
      await persistBriefing(db, todayStr, {}, null, "failed", "quotes-fetch queue non-empty after max retries");
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

  // ── Step 1: field coverage precheck ───────────────────────
  let fieldRetries = 0;
  let todayQuotes: Quote[] = [];

  while (true) {
    todayQuotes = await queryTodayQuotes(db, todayStr);
    const presentKeys = new Set(todayQuotes.map((q) => q.metricKey));
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

  const briefingInput = buildBriefingInput(todayQuotes, contextNews);

  // ── Step 3: LLM 7-segment generation ──────────────────────
  let llmOutput: BriefingOutput;
  try {
    const result = await llmRunBriefingGen(briefingInput);
    llmOutput = result.value;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error, briefingDate: todayStr }, "briefing-gen: LLM generation failed");
    await persistBriefing(db, todayStr, {}, null, "failed", errMsg);
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

  // Build flat template fields from payload
  const templateFields = buildTemplateFields(payloadJson, todayStr);

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
    await persistBriefing(db, todayStr, payloadJson, null, "failed", errMsg);
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
    null
  );

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
  genError: string | null
): Promise<number> {
  const [row] = await db
    .insert(commodityBriefings)
    .values({
      briefingDate,
      templateVersion: 1,
      payloadJson,
      docxPath,
      genStatus,
      genError,
      generatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: commodityBriefings.id });

  // If onConflictDoNothing fired (already exists), fetch existing id
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

function buildTemplateFields(
  payload: BriefingPayloadJson,
  briefingDate: string
): Record<string, string> {
  const fallback = "—";

  function fmt(v: number | null | undefined): string {
    if (v === null || v === undefined) return fallback;
    return String(v);
  }

  return {
    briefing_date: briefingDate,
    // CU fields
    "cu.logic_summary": payload.cu.logic_summary ?? fallback,
    "cu.outlook.trend": payload.cu.outlook.trend ?? fallback,
    "cu.outlook.support": fmt(payload.cu.outlook.support),
    "cu.outlook.resistance": fmt(payload.cu.outlook.resistance),
    // LC fields
    "lc.logic_summary": payload.lc.logic_summary ?? fallback,
    "lc.outlook.trend": payload.lc.outlook.trend ?? fallback,
    "lc.outlook.support": fmt(payload.lc.outlook.support),
    "lc.outlook.resistance": fmt(payload.lc.outlook.resistance),
    // Shared fields
    macro_summary: payload.macro_summary ?? fallback,
    risk_notes: Array.isArray(payload.risk_notes)
      ? payload.risk_notes.join("；")
      : fallback,
    procurement_advice: payload.procurement_advice ?? fallback,
  };
}
