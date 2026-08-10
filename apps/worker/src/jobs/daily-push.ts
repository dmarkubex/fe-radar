/**
 * Scheduled / manual 产业日报 push — CAS claim-first (T17a).
 *
 * Invariants (see `.ai/reviews/2026-08-10-dp-fix-spec-final.md`):
 * - Business key: (reportDate, targetId); at most one row.
 * - INSERT claim first; webhook only after atomic authorize UPDATE.
 * - Ownership cursor: { id, expectedAttemptCount }; never match on pushedAt equality.
 * - failed is not auto-retried by minute tick; only manual reclaim.
 * - stale pending (≥120s DB clock) → mark failed STALE_PENDING_DELIVERY_UNKNOWN, no auto send.
 * - succeeded is permanent terminal.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import pLimit from "p-limit";
import {
  getDb,
  dailyPushConfig,
  dailyPushes,
  dailyReports,
  briefingTargets,
  briefingHolidays,
} from "@fe-radar/db";
import { buildDailyPushCard, hasDailyContent, isBusinessDay } from "@fe-radar/core";
import type { DailyReportSections } from "@fe-radar/core";
import { APP_TIMEZONE, createLogger, dayjs } from "@fe-radar/shared";
import { sendActionCard } from "../lib/dingtalk-bot";

const logger = createLogger({ service: "daily-push" });

const PUSH_CONCURRENCY = 3;
const RETRY_DELAYS_MS = [1_000, 4_000, 16_000] as const;
const MAX_ATTEMPTS = 3;
/** Spec §3: stale pending lease threshold (DB-side). */
const STALE_PENDING_SECONDS = 120;
export const STALE_PENDING_ERROR = "STALE_PENDING_DELIVERY_UNKNOWN";

export interface DailyPushResult {
  skipped: boolean;
  reason?: string;
  reportDate?: string;
  succeeded: number;
  failed: number;
  skippedSucceeded: number;
  /** Claim lost / non-stale pending / failed tick skip / lost ownership mid-flight. */
  skippedClaimed: number;
}

export interface RunScheduledDailyPushOptions {
  /** Injected clock for tests / single tick sample; defaults to now. */
  now?: Date;
  /** Injected sleep for tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

export interface RunManualDailyPushOptions {
  sleepFn?: (ms: number) => Promise<void>;
}

interface TargetRow {
  id: number;
  name: string;
  webhookUrl: string;
  signSecret: string | null;
}

interface ConfigRow {
  enabled: boolean;
  sendTime: string;
  scheduleMode: string;
  baseUrl: string;
}

interface ClaimCursor {
  id: number;
  expectedAttemptCount: number;
}

type CardPayload = {
  title: string;
  text: string;
  btns: Array<{ title: string; actionURL: string }>;
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadHolidaySet(): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ holidayDate: briefingHolidays.holidayDate })
    .from(briefingHolidays);
  return new Set(rows.map((r) => r.holidayDate as string));
}

function emptyResult(
  partial: Partial<DailyPushResult> & { skipped: boolean; reason?: string; reportDate?: string }
): DailyPushResult {
  return {
    succeeded: 0,
    failed: 0,
    skippedSucceeded: 0,
    skippedClaimed: 0,
    ...partial,
  };
}

/** DB-side stale predicate (never compare JS Date for ownership). */
function stalePendingSql() {
  return sql`(
    ${dailyPushes.pushedAt} IS NULL
    OR ${dailyPushes.pushedAt} <= now() - make_interval(secs => ${STALE_PENDING_SECONDS})
  )`;
}

/**
 * INSERT claim: only RETURNING winner may proceed to authorize.
 * pushedAt is DB clock; attemptCount starts at 0.
 */
async function insertClaim(
  reportDate: string,
  targetId: number,
  dailyPresent: boolean
): Promise<ClaimCursor | null> {
  const db = getDb();
  const claimed = await db
    .insert(dailyPushes)
    .values({
      reportDate,
      targetId,
      briefingId: null,
      dailyReportPresent: dailyPresent,
      briefingPresent: false,
      pushStatus: "pending",
      attemptCount: 0,
      errorDetail: null,
      // Spec: non-null DB clock lease at claim time — never JS Date for ownership.
      pushedAt: sql`now()`,
    })
    .onConflictDoNothing({
      target: [dailyPushes.reportDate, dailyPushes.targetId],
    })
    .returning({
      id: dailyPushes.id,
      attemptCount: dailyPushes.attemptCount,
    });

  const row = claimed[0];
  if (row == null) return null;
  return { id: row.id, expectedAttemptCount: row.attemptCount };
}

/**
 * Pre-webhook authorize: confirm ownership + attempt_count+1 + DB lease renew
 * in a single conditional UPDATE. Returns new expectedAttemptCount or null if lost.
 */
async function authorizeWebhookAttempt(
  claimId: number,
  expectedAttemptCount: number
): Promise<number | null> {
  const db = getDb();
  const rows = await db
    .update(dailyPushes)
    .set({
      attemptCount: sql`${dailyPushes.attemptCount} + 1`,
      pushedAt: sql`now()`,
    })
    .where(
      and(
        eq(dailyPushes.id, claimId),
        eq(dailyPushes.pushStatus, "pending"),
        eq(dailyPushes.attemptCount, expectedAttemptCount)
      )
    )
    .returning({ attemptCount: dailyPushes.attemptCount });

  const next = rows[0]?.attemptCount;
  return next == null ? null : next;
}

/**
 * Manual reclaim: failed → pending, or stale pending → pending, merged with
 * first webhook authorization (attempt_count+1 + lease) in one UPDATE.
 */
async function reclaimFailedOrStale(claimId: number): Promise<number | null> {
  const db = getDb();
  const rows = await db
    .update(dailyPushes)
    .set({
      pushStatus: "pending",
      attemptCount: sql`${dailyPushes.attemptCount} + 1`,
      pushedAt: sql`now()`,
      errorDetail: null,
    })
    .where(
      and(
        eq(dailyPushes.id, claimId),
        sql`(
          ${dailyPushes.pushStatus} = 'failed'
          OR (
            ${dailyPushes.pushStatus} = 'pending'
            AND ${stalePendingSql()}
          )
        )`
      )
    )
    .returning({ attemptCount: dailyPushes.attemptCount });

  const next = rows[0]?.attemptCount;
  return next == null ? null : next;
}

/**
 * Scheduled path only: atomically mark stale pending as failed (delivery unknown).
 * Only the first converter succeeds (RETURNING); that caller logs once.
 */
async function markStalePendingFailed(claimId: number): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(dailyPushes)
    .set({
      pushStatus: "failed",
      errorDetail: STALE_PENDING_ERROR,
      pushedAt: sql`now()`,
    })
    .where(
      and(
        eq(dailyPushes.id, claimId),
        eq(dailyPushes.pushStatus, "pending"),
        stalePendingSql()
      )
    )
    .returning({ id: dailyPushes.id });

  return rows.length === 1;
}

/**
 * Terminal CAS: match id + pending + expectedAttemptCount only (no pushedAt equality).
 */
async function finalizePush(
  claimId: number,
  expectedAttemptCount: number,
  pushStatus: "succeeded" | "failed",
  errorDetail: string | null,
  dailyPresent: boolean
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(dailyPushes)
    .set({
      briefingId: null,
      dailyReportPresent: dailyPresent,
      briefingPresent: false,
      pushStatus,
      errorDetail,
      pushedAt: sql`now()`,
      // attemptCount already advanced by authorize; do not bulk-overwrite from result.
    })
    .where(
      and(
        eq(dailyPushes.id, claimId),
        eq(dailyPushes.pushStatus, "pending"),
        eq(dailyPushes.attemptCount, expectedAttemptCount)
      )
    )
    .returning({ id: dailyPushes.id });

  return rows.length === 1;
}

/**
 * After initial claim (or after reclaim that already authorized once):
 * each webhook is preceded by its own authorize UPDATE (except the first
 * attempt when reclaim already authorized).
 */
async function sendWithCas(
  target: TargetRow,
  card: CardPayload,
  cursor: ClaimCursor,
  opts: {
    sleepFn: (ms: number) => Promise<void>;
    dailyPresent: boolean;
    /** When true, first loop iteration skips authorize (reclaim already did it). */
    firstAttemptAlreadyAuthorized: boolean;
  }
): Promise<"succeeded" | "failed" | "lost_ownership"> {
  let expected = cursor.expectedAttemptCount;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const skipAuth = opts.firstAttemptAlreadyAuthorized && attempt === 1;
    if (!skipAuth) {
      const authorized = await authorizeWebhookAttempt(cursor.id, expected);
      if (authorized == null) {
        logger.info(
          { targetId: target.id, claimId: cursor.id, expectedAttemptCount: expected, attempt },
          "daily-push: authorize lost ownership, not sending"
        );
        return "lost_ownership";
      }
      expected = authorized;
    }

    try {
      await sendActionCard(target.webhookUrl, target.signSecret ?? "", {
        title: card.title,
        text: card.text,
        btns: card.btns,
      });
      const ok = await finalizePush(cursor.id, expected, "succeeded", null, opts.dailyPresent);
      if (!ok) {
        logger.warn(
          { targetId: target.id, claimId: cursor.id, expectedAttemptCount: expected },
          "daily-push: succeeded webhook but terminal CAS lost (delivery ambiguity)"
        );
        return "lost_ownership";
      }
      return "succeeded";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn(
        { targetId: target.id, targetName: target.name, attempt, err: lastError },
        "daily-push: attempt failed"
      );
      if (attempt < MAX_ATTEMPTS) {
        await opts.sleepFn(RETRY_DELAYS_MS[attempt - 1] ?? 1_000);
      }
    }
  }

  const ok = await finalizePush(cursor.id, expected, "failed", lastError || "unknown", opts.dailyPresent);
  if (!ok) {
    logger.warn(
      { targetId: target.id, claimId: cursor.id, expectedAttemptCount: expected },
      "daily-push: failed terminal CAS lost ownership"
    );
    return "lost_ownership";
  }
  logger.error(
    { targetId: target.id, targetName: target.name, error: lastError },
    "daily-push: target failed after all retries"
  );
  return "failed";
}

async function loadExistingPush(
  reportDate: string,
  targetId: number
): Promise<{ id: number; pushStatus: string; attemptCount: number } | null> {
  const db = getDb();
  const [existing] = await db
    .select({
      id: dailyPushes.id,
      pushStatus: dailyPushes.pushStatus,
      attemptCount: dailyPushes.attemptCount,
    })
    .from(dailyPushes)
    .where(and(eq(dailyPushes.reportDate, reportDate), eq(dailyPushes.targetId, targetId)))
    .limit(1);
  return existing ?? null;
}

/**
 * Scheduled path for a single target: INSERT claim or skip / mark stale.
 * Never auto-retries failed; never sends on non-stale pending.
 */
async function processTargetScheduled(
  reportDate: string,
  target: TargetRow,
  card: CardPayload,
  dailyPresent: boolean,
  sleepFn: (ms: number) => Promise<void>
): Promise<"succeeded" | "failed" | "skippedSucceeded" | "skippedClaimed"> {
  const claimed = await insertClaim(reportDate, target.id, dailyPresent);
  if (claimed) {
    const outcome = await sendWithCas(target, card, claimed, {
      sleepFn,
      dailyPresent,
      firstAttemptAlreadyAuthorized: false,
    });
    if (outcome === "succeeded") return "succeeded";
    if (outcome === "failed") return "failed";
    return "skippedClaimed";
  }

  const existing = await loadExistingPush(reportDate, target.id);
  if (existing?.pushStatus === "succeeded") {
    logger.info(
      { reportDate, targetId: target.id },
      "daily-push: already succeeded, skipping duplicate"
    );
    return "skippedSucceeded";
  }

  if (existing?.pushStatus === "failed") {
    logger.info(
      { reportDate, targetId: target.id, attemptCount: existing.attemptCount },
      "daily-push: failed row not auto-retried on tick"
    );
    return "skippedClaimed";
  }

  if (existing?.pushStatus === "pending") {
    const marked = await markStalePendingFailed(existing.id);
    if (marked) {
      // Only first converter alerts once.
      logger.error(
        {
          reportDate,
          targetId: target.id,
          claimId: existing.id,
          code: STALE_PENDING_ERROR,
        },
        "daily-push: stale pending marked failed (delivery unknown); requires manual repush"
      );
    } else {
      logger.info(
        { reportDate, targetId: target.id, claimId: existing.id },
        "daily-push: pending still leased or already handled, not sending"
      );
    }
    return "skippedClaimed";
  }

  logger.info(
    { reportDate, targetId: target.id, existingStatus: existing?.pushStatus ?? null },
    "daily-push: claim lost with unknown state, not sending"
  );
  return "skippedClaimed";
}

/**
 * Manual path for a single target: INSERT, or reclaim failed/stale, then send.
 * succeeded rows are never force-resent.
 */
async function processTargetManual(
  reportDate: string,
  target: TargetRow,
  card: CardPayload,
  dailyPresent: boolean,
  sleepFn: (ms: number) => Promise<void>
): Promise<"succeeded" | "failed" | "skippedSucceeded" | "skippedClaimed"> {
  const claimed = await insertClaim(reportDate, target.id, dailyPresent);
  if (claimed) {
    const outcome = await sendWithCas(target, card, claimed, {
      sleepFn,
      dailyPresent,
      firstAttemptAlreadyAuthorized: false,
    });
    if (outcome === "succeeded") return "succeeded";
    if (outcome === "failed") return "failed";
    return "skippedClaimed";
  }

  const existing = await loadExistingPush(reportDate, target.id);
  if (existing?.pushStatus === "succeeded") {
    logger.info(
      { reportDate, targetId: target.id },
      "daily-push manual: already succeeded, no force resend"
    );
    return "skippedSucceeded";
  }

  if (!existing) {
    logger.info({ reportDate, targetId: target.id }, "daily-push manual: claim lost, no row");
    return "skippedClaimed";
  }

  // failed or (possibly) stale pending — atomic reclaim + first authorize.
  if (existing.pushStatus === "failed" || existing.pushStatus === "pending") {
    const newAttempt = await reclaimFailedOrStale(existing.id);
    if (newAttempt == null) {
      logger.info(
        { reportDate, targetId: target.id, claimId: existing.id, status: existing.pushStatus },
        "daily-push manual: reclaim lost (concurrent or not reclaimable)"
      );
      return "skippedClaimed";
    }
    const outcome = await sendWithCas(
      target,
      card,
      { id: existing.id, expectedAttemptCount: newAttempt },
      {
        sleepFn,
        dailyPresent,
        firstAttemptAlreadyAuthorized: true,
      }
    );
    if (outcome === "succeeded") return "succeeded";
    if (outcome === "failed") return "failed";
    return "skippedClaimed";
  }

  return "skippedClaimed";
}

async function loadConfig(): Promise<ConfigRow | null> {
  const db = getDb();
  const [config] = await db
    .select({
      enabled: dailyPushConfig.enabled,
      sendTime: dailyPushConfig.sendTime,
      scheduleMode: dailyPushConfig.scheduleMode,
      baseUrl: dailyPushConfig.baseUrl,
    })
    .from(dailyPushConfig)
    .where(eq(dailyPushConfig.id, 1))
    .limit(1);
  return (config as ConfigRow | undefined) ?? null;
}

/**
 * Early-exit probe: one round-trip listing active targets joined to succeeded pushes.
 * All succeeded → skip without loading card body.
 */
async function allActiveTargetsSucceeded(reportDate: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({
      targetId: briefingTargets.id,
      succeededPushId: dailyPushes.id,
    })
    .from(briefingTargets)
    .leftJoin(
      dailyPushes,
      and(
        eq(dailyPushes.targetId, briefingTargets.id),
        eq(dailyPushes.reportDate, reportDate),
        eq(dailyPushes.pushStatus, "succeeded")
      )
    )
    .where(and(eq(briefingTargets.enabled, true), isNull(briefingTargets.disabledAt)));

  if (rows.length === 0) return false;
  return rows.every((r) => r.succeededPushId != null);
}

async function loadDailyPresent(reportDate: string): Promise<{
  present: boolean;
  sections: DailyReportSections | null;
}> {
  const db = getDb();
  const [dailyRow] = await db
    .select({
      date: dailyReports.date,
      sections: dailyReports.sections,
    })
    .from(dailyReports)
    .where(eq(dailyReports.date, reportDate))
    .limit(1);

  const sections = (dailyRow?.sections as DailyReportSections | null | undefined) ?? null;
  return { present: hasDailyContent(sections), sections };
}

async function loadActiveTargets(): Promise<TargetRow[]> {
  const db = getDb();
  return db
    .select({
      id: briefingTargets.id,
      name: briefingTargets.name,
      webhookUrl: briefingTargets.webhookUrl,
      signSecret: briefingTargets.signSecret,
    })
    .from(briefingTargets)
    .where(and(eq(briefingTargets.enabled, true), isNull(briefingTargets.disabledAt)));
}

async function pushToAllTargets(
  reportDate: string,
  targets: TargetRow[],
  card: CardPayload,
  dailyPresent: boolean,
  sleepFn: (ms: number) => Promise<void>,
  mode: "scheduled" | "manual"
): Promise<DailyPushResult> {
  const limit = pLimit(PUSH_CONCURRENCY);
  let succeeded = 0;
  let failed = 0;
  let skippedSucceeded = 0;
  let skippedClaimed = 0;

  await Promise.all(
    targets.map((target) =>
      limit(async () => {
        const outcome =
          mode === "scheduled"
            ? await processTargetScheduled(reportDate, target, card, dailyPresent, sleepFn)
            : await processTargetManual(reportDate, target, card, dailyPresent, sleepFn);
        if (outcome === "succeeded") succeeded++;
        else if (outcome === "failed") failed++;
        else if (outcome === "skippedSucceeded") skippedSucceeded++;
        else skippedClaimed++;
      })
    )
  );

  logger.info(
    { reportDate, mode, succeeded, failed, skippedSucceeded, skippedClaimed },
    "daily-push: completed"
  );

  return {
    skipped: false,
    reportDate,
    succeeded,
    failed,
    skippedSucceeded,
    skippedClaimed,
  };
}

/**
 * Entry for cron minute-tick: read DB schedule and push with CAS claim-first.
 * `options.now` must be the single clock sample from bootstrap when provided.
 */
export async function runScheduledDailyPush(
  options: RunScheduledDailyPushOptions = {}
): Promise<DailyPushResult> {
  const sleepFn = options.sleepFn ?? sleep;
  // Single Asia/Shanghai conversion for this invocation (spec §5).
  const now = options.now ? dayjs(options.now).tz(APP_TIMEZONE) : dayjs().tz(APP_TIMEZONE);
  const reportDate = now.format("YYYY-MM-DD");
  const currentHm = now.format("HH:mm");

  const cfg = await loadConfig();
  if (!cfg) {
    logger.info({ reportDate }, "daily-push skipped: config row missing");
    return emptyResult({ skipped: true, reason: "config_missing" });
  }

  if (!cfg.enabled) {
    logger.info({ reportDate, sendTime: cfg.sendTime }, "daily-push skipped: disabled");
    return emptyResult({ skipped: true, reason: "disabled", reportDate });
  }

  // ponytail: `>=`, not `==` — later ticks retry until content lands; claim keeps one send.
  if (currentHm < cfg.sendTime) {
    logger.info(
      { reportDate, sendTime: cfg.sendTime, currentHm },
      "daily-push skipped: before send_time"
    );
    return emptyResult({ skipped: true, reason: "time_mismatch", reportDate });
  }

  if (cfg.scheduleMode === "business_days") {
    const holidaySet = await loadHolidaySet();
    if (!isBusinessDay(reportDate, holidaySet)) {
      logger.info({ reportDate }, "daily-push skipped: not a business day");
      return emptyResult({ skipped: true, reason: "not_business_day", reportDate });
    }
  }

  // Early exit (≤1 RT after config/holiday): do not load card or enter send loop.
  if (await allActiveTargetsSucceeded(reportDate)) {
    logger.info({ reportDate }, "daily-push skipped: all active targets already succeeded");
    return emptyResult({ skipped: true, reason: "all_targets_succeeded", reportDate });
  }

  const { present: dailyPresent, sections } = await loadDailyPresent(reportDate);
  if (!dailyPresent) {
    logger.info({ reportDate, dailyPresent }, "daily-push skipped: no content");
    return emptyResult({ skipped: true, reason: "no_content", reportDate });
  }

  const targets = await loadActiveTargets();
  if (targets.length === 0) {
    logger.info({ reportDate }, "daily-push skipped: no active targets");
    return emptyResult({ skipped: true, reason: "no_targets", reportDate });
  }

  let card: CardPayload;
  try {
    card = buildDailyPushCard({
      reportDate,
      baseUrl: cfg.baseUrl,
      dailySections: sections!,
      briefing: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ reportDate, err: message }, "daily-push: card build failed");
    return emptyResult({ skipped: true, reason: "card_build_failed", reportDate });
  }

  logger.info(
    { reportDate, targetCount: targets.length, dailyPresent },
    "daily-push: starting push"
  );

  return pushToAllTargets(reportDate, targets, card, dailyPresent, sleepFn, "scheduled");
}

/**
 * Manual repush for a calendar reportDate (from daily-repush job).
 * Skips enabled + send_time gates; still validates business day / content / claim CAS.
 */
export async function runManualDailyPush(
  reportDate: string,
  options: RunManualDailyPushOptions = {}
): Promise<DailyPushResult> {
  const sleepFn = options.sleepFn ?? sleep;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    logger.info({ reportDate }, "daily-push manual skipped: invalid reportDate");
    return emptyResult({ skipped: true, reason: "invalid_report_date", reportDate });
  }

  const cfg = await loadConfig();
  if (!cfg) {
    logger.info({ reportDate }, "daily-push manual skipped: config row missing");
    return emptyResult({ skipped: true, reason: "config_missing", reportDate });
  }

  // Use requested reportDate for business-day check — never wall-clock "today".
  if (cfg.scheduleMode === "business_days") {
    const holidaySet = await loadHolidaySet();
    if (!isBusinessDay(reportDate, holidaySet)) {
      logger.info({ reportDate }, "daily-push manual skipped: not a business day");
      return emptyResult({ skipped: true, reason: "not_business_day", reportDate });
    }
  }

  if (await allActiveTargetsSucceeded(reportDate)) {
    logger.info({ reportDate }, "daily-push manual: all targets already succeeded");
    return emptyResult({ skipped: true, reason: "all_targets_succeeded", reportDate });
  }

  const { present: dailyPresent, sections } = await loadDailyPresent(reportDate);
  if (!dailyPresent) {
    logger.info({ reportDate }, "daily-push manual skipped: no content");
    return emptyResult({ skipped: true, reason: "no_content", reportDate });
  }

  const targets = await loadActiveTargets();
  if (targets.length === 0) {
    logger.info({ reportDate }, "daily-push manual skipped: no active targets");
    return emptyResult({ skipped: true, reason: "no_targets", reportDate });
  }

  let card: CardPayload;
  try {
    card = buildDailyPushCard({
      reportDate,
      baseUrl: cfg.baseUrl,
      dailySections: sections!,
      briefing: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ reportDate, err: message }, "daily-push manual: card build failed");
    return emptyResult({ skipped: true, reason: "card_build_failed", reportDate });
  }

  logger.info(
    { reportDate, targetCount: targets.length },
    "daily-push manual: starting push"
  );

  return pushToAllTargets(reportDate, targets, card, dailyPresent, sleepFn, "manual");
}
