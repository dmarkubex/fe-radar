import { sql } from "drizzle-orm";
import { getDb, listSources, markSourceFailure, markSourceSuccess, briefingHolidays } from "@fe-radar/db";
import { isBusinessDay } from "@fe-radar/core";
import { createLogger } from "@fe-radar/shared";
import { fetchQuotes } from "../fetchers/quotes";
import type { FetchContext } from "../fetchers/types";
import type { QuoteSample } from "../fetchers/quotes/types";

const logger = createLogger({ service: "quotes-fetch" });

/** Tier text → numeric priority (lower = higher priority). */
const TIER_PRIORITY: Record<string, number> = { T1: 1, T2: 2, T3: 3 };

const DISABLE_AFTER_FAIL_COUNT = 7;
const WARN_AFTER_NULL_VALUE_DAYS = 3;

async function loadHolidaySet(): Promise<Set<string>> {
  const db = getDb();
  const rows = await db.select({ holidayDate: briefingHolidays.holidayDate }).from(briefingHolidays);
  return new Set(rows.map((r) => r.holidayDate as string));
}

async function upsertQuoteSamples(
  sourceId: number,
  sourceTier: string,
  samples: QuoteSample[]
): Promise<number> {
  if (samples.length === 0) return 0;

  const db = getDb();
  const tierNum = TIER_PRIORITY[sourceTier] ?? 3;

  let upserted = 0;
  for (const sample of samples) {
    /**
     * Tier-priority upsert (T-CB-09 v0.4 fix M3):
     *   ON CONFLICT (metric_key, observed_at) DO UPDATE
     *   only when the incoming source tier <= existing source tier
     *   (T1=1 beats T2=2 beats T3=3; equal tier = last-write-wins).
     *
     * We materialise the existing tier via a sub-SELECT on sources
     * inside the WHERE clause of the DO UPDATE.
     */
    await db.execute(sql`
      INSERT INTO commodity_quotes
        (metric_key, value, change_pct, source_id, raw_text, observed_at, fetched_at)
      VALUES (
        ${sample.metricKey},
        ${sample.value ?? null},
        ${null},
        ${sourceId},
        ${sample.rawText},
        ${sample.observedAt},
        now()
      )
      ON CONFLICT (metric_key, observed_at) DO UPDATE
        SET value      = EXCLUDED.value,
            change_pct = EXCLUDED.change_pct,
            source_id  = EXCLUDED.source_id,
            raw_text   = EXCLUDED.raw_text,
            fetched_at = now()
      WHERE ${tierNum} <= (
        SELECT CASE s.tier
                 WHEN 'T1' THEN 1
                 WHEN 'T2' THEN 2
                 WHEN 'T3' THEN 3
                 ELSE 3
               END
        FROM sources s
        WHERE s.id = commodity_quotes.source_id
        LIMIT 1
      )
    `);
    upserted++;
  }
  return upserted;
}

export interface QuotesFetchResult {
  sourceId: number;
  upserted: number;
  skipped: boolean;
}

export async function runQuotesFetch(sourceId: number): Promise<QuotesFetchResult> {
  const now = new Date();

  // --- holiday check ---
  const holidaySet = await loadHolidaySet();
  if (!isBusinessDay(now, holidaySet)) {
    logger.info({ sourceId }, "quotes-fetch skipped: not a business day");
    return { sourceId, upserted: 0, skipped: true };
  }

  const db = getDb();
  const allSources = await listSources(db, { enabled: true });
  const source = allSources.find((s) => s.id === sourceId && s.fetcherType === "quotes");
  if (!source) {
    logger.warn({ sourceId }, "quotes source not found or disabled");
    return { sourceId, upserted: 0, skipped: true };
  }

  const ctx: FetchContext = { sourceName: source.name, useRealUa: true };

  let samples: QuoteSample[];
  try {
    samples = await fetchQuotes(source, ctx);
  } catch (error) {
    logger.error({ error, sourceId, sourceName: source.name }, "quotes fetch failed");
    const nextFail = source.failCount + 1;
    await markSourceFailure(db, source.id, nextFail, nextFail >= DISABLE_AFTER_FAIL_COUNT);
    throw error;
  }

  if (samples.length === 0) {
    logger.warn({ sourceId, sourceName: source.name }, "quotes fetch returned empty samples");
    const nextFail = source.failCount + 1;
    await markSourceFailure(db, source.id, nextFail, nextFail >= DISABLE_AFTER_FAIL_COUNT);
    return { sourceId, upserted: 0, skipped: false };
  }

  const upserted = await upsertQuoteSamples(source.id, source.tier, samples);
  const hasNonNullValue = samples.some((sample) => sample.value !== null);
  if (!hasNonNullValue) {
    const nextFail = source.failCount + 1;
    await markSourceFailure(db, source.id, nextFail, nextFail >= DISABLE_AFTER_FAIL_COUNT);
    if (nextFail >= WARN_AFTER_NULL_VALUE_DAYS) {
      logger.warn(
        { sourceId, sourceName: source.name, failCount: nextFail },
        "quotes fetch returned only null values; admin dashboard warning threshold reached"
      );
    }
    return { sourceId, upserted, skipped: false };
  }

  await markSourceSuccess(db, source.id);

  logger.info({ sourceId, sourceName: source.name, upserted }, "quotes-fetch completed");
  return { sourceId, upserted, skipped: false };
}
