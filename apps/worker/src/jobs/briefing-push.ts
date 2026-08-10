/**
 * Scheduled / manual 铜锂简报 push — CAS claim-first (T17b, mirrors daily-push T17a).
 *
 * Invariants (see `.ai/reviews/2026-08-10-dp-fix-spec-final.md`):
 * - Business key: (briefingId, targetId); at most one row.
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
  commodityBriefings,
  briefingTargets,
  briefingPushes,
  briefingHolidays,
  dailyPushConfig,
} from "@fe-radar/db";
import { isBusinessDay } from "@fe-radar/core";
import { APP_TIMEZONE, createLogger, dayjs } from "@fe-radar/shared";
import { sendActionCard } from "../lib/dingtalk-bot";

const logger = createLogger({ service: "briefing-push" });

/** Concurrency limit for DingTalk webhook calls (avoids single-IP rate limit). */
const PUSH_CONCURRENCY = 3;

/** Exponential backoff delays in ms: 1s / 4s / 16s (×1 ×4 ×16). */
const RETRY_DELAYS_MS = [1_000, 4_000, 16_000] as const;

/** Max push attempts per target (up to 3 webhook calls per claim lifecycle). */
const MAX_ATTEMPTS = 3;

/** Spec §3: stale pending lease threshold (DB-side). Same value as daily-push. */
const STALE_PENDING_SECONDS = 120;
export const STALE_PENDING_ERROR = "STALE_PENDING_DELIVERY_UNKNOWN";

const INTRANET_BASE_URL =
  process.env["INTRANET_URL"] ??
  process.env["NEXT_PUBLIC_APP_URL"] ??
  "http://fe-radar.internal";

export interface BriefingPushResult {
  briefingId: number;
  succeeded: number;
  failed: number;
  skipped: boolean;
  reason?: string;
  skippedSucceeded: number;
  /** Claim lost / non-stale pending / failed tick skip / lost ownership mid-flight. */
  skippedClaimed: number;
}

export interface RunBriefingPushOptions {
  /** Card deep-link host; scheduled path passes daily_push_config.base_url. */
  baseUrl?: string;
  /** scheduled: no reclaim; manual: reclaim failed/stale. Default "manual". */
  mode?: "scheduled" | "manual";
  /**
   * Asia/Shanghai YYYY-MM-DD from the single clock sample (scheduled path).
   * When set with mode "scheduled", business-day check uses this string.
   * Manual path ignores this field and uses the loaded briefing.briefingDate
   * (must not mix in request-time wall clock).
   */
  reportDate?: string;
  /** Injected sleep for tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

export interface RunScheduledBriefingPushOptions {
  /** Injected clock for tests / single tick sample; defaults to now. */
  now?: Date;
  sleepFn?: (ms: number) => Promise<void>;
}

interface TargetRow {
  id: number;
  name: string;
  webhookUrl: string;
  signSecret: string | null;
}

interface BriefingRow {
  id: number;
  briefingDate: string;
  payloadJson: unknown;
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
  partial: Partial<BriefingPushResult> & {
    briefingId: number;
    skipped: boolean;
    reason?: string;
  }
): BriefingPushResult {
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
    ${briefingPushes.pushedAt} IS NULL
    OR ${briefingPushes.pushedAt} <= now() - make_interval(secs => ${STALE_PENDING_SECONDS})
  )`;
}

/**
 * INSERT claim: only RETURNING winner may proceed to authorize.
 * pushedAt is DB clock; attemptCount starts at 0.
 */
async function insertClaim(
  briefingId: number,
  targetId: number
): Promise<ClaimCursor | null> {
  const db = getDb();
  const claimed = await db
    .insert(briefingPushes)
    .values({
      briefingId,
      targetId,
      pushStatus: "pending",
      attemptCount: 0,
      errorDetail: null,
      // Spec: non-null DB clock lease at claim time — never JS Date for ownership.
      pushedAt: sql`now()`,
    })
    .onConflictDoNothing({
      target: [briefingPushes.briefingId, briefingPushes.targetId],
    })
    .returning({
      id: briefingPushes.id,
      attemptCount: briefingPushes.attemptCount,
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
    .update(briefingPushes)
    .set({
      attemptCount: sql`${briefingPushes.attemptCount} + 1`,
      pushedAt: sql`now()`,
    })
    .where(
      and(
        eq(briefingPushes.id, claimId),
        eq(briefingPushes.pushStatus, "pending"),
        eq(briefingPushes.attemptCount, expectedAttemptCount)
      )
    )
    .returning({ attemptCount: briefingPushes.attemptCount });

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
    .update(briefingPushes)
    .set({
      pushStatus: "pending",
      attemptCount: sql`${briefingPushes.attemptCount} + 1`,
      pushedAt: sql`now()`,
      errorDetail: null,
    })
    .where(
      and(
        eq(briefingPushes.id, claimId),
        sql`(
          ${briefingPushes.pushStatus} = 'failed'
          OR (
            ${briefingPushes.pushStatus} = 'pending'
            AND ${stalePendingSql()}
          )
        )`
      )
    )
    .returning({ attemptCount: briefingPushes.attemptCount });

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
    .update(briefingPushes)
    .set({
      pushStatus: "failed",
      errorDetail: STALE_PENDING_ERROR,
      pushedAt: sql`now()`,
    })
    .where(
      and(
        eq(briefingPushes.id, claimId),
        eq(briefingPushes.pushStatus, "pending"),
        stalePendingSql()
      )
    )
    .returning({ id: briefingPushes.id });

  return rows.length === 1;
}

/**
 * Terminal CAS: match id + pending + expectedAttemptCount only (no pushedAt equality).
 * Exported for CAS unit tests (stale cursor after reclaim must affect 0 rows).
 */
export async function finalizePush(
  claimId: number,
  expectedAttemptCount: number,
  pushStatus: "succeeded" | "failed",
  errorDetail: string | null
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(briefingPushes)
    .set({
      pushStatus,
      errorDetail,
      pushedAt: sql`now()`,
      // attemptCount already advanced by authorize; do not bulk-overwrite from result.
    })
    .where(
      and(
        eq(briefingPushes.id, claimId),
        eq(briefingPushes.pushStatus, "pending"),
        eq(briefingPushes.attemptCount, expectedAttemptCount)
      )
    )
    .returning({ id: briefingPushes.id });

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
          "briefing-push: authorize lost ownership, not sending"
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
      const ok = await finalizePush(cursor.id, expected, "succeeded", null);
      if (!ok) {
        logger.warn(
          { targetId: target.id, claimId: cursor.id, expectedAttemptCount: expected },
          "briefing-push: succeeded webhook but terminal CAS lost (delivery ambiguity)"
        );
        return "lost_ownership";
      }
      return "succeeded";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn(
        { targetId: target.id, targetName: target.name, attempt, err: lastError },
        "briefing-push: attempt failed"
      );
      if (attempt < MAX_ATTEMPTS) {
        await opts.sleepFn(RETRY_DELAYS_MS[attempt - 1] ?? 1_000);
      }
    }
  }

  const ok = await finalizePush(cursor.id, expected, "failed", lastError || "unknown");
  if (!ok) {
    logger.warn(
      { targetId: target.id, claimId: cursor.id, expectedAttemptCount: expected },
      "briefing-push: failed terminal CAS lost ownership"
    );
    return "lost_ownership";
  }
  logger.error(
    { targetId: target.id, targetName: target.name, error: lastError },
    "briefing-push: target failed after all retries"
  );
  return "failed";
}

async function loadExistingPush(
  briefingId: number,
  targetId: number
): Promise<{ id: number; pushStatus: string; attemptCount: number } | null> {
  const db = getDb();
  const [existing] = await db
    .select({
      id: briefingPushes.id,
      pushStatus: briefingPushes.pushStatus,
      attemptCount: briefingPushes.attemptCount,
    })
    .from(briefingPushes)
    .where(
      and(eq(briefingPushes.briefingId, briefingId), eq(briefingPushes.targetId, targetId))
    )
    .limit(1);
  return existing ?? null;
}

/**
 * Scheduled path for a single target: INSERT claim or skip / mark stale.
 * Never auto-retries failed; never sends on non-stale pending.
 */
async function processTargetScheduled(
  briefingId: number,
  target: TargetRow,
  card: CardPayload,
  sleepFn: (ms: number) => Promise<void>
): Promise<"succeeded" | "failed" | "skippedSucceeded" | "skippedClaimed"> {
  const claimed = await insertClaim(briefingId, target.id);
  if (claimed) {
    const outcome = await sendWithCas(target, card, claimed, {
      sleepFn,
      firstAttemptAlreadyAuthorized: false,
    });
    if (outcome === "succeeded") return "succeeded";
    if (outcome === "failed") return "failed";
    return "skippedClaimed";
  }

  const existing = await loadExistingPush(briefingId, target.id);
  if (existing?.pushStatus === "succeeded") {
    logger.info(
      { briefingId, targetId: target.id },
      "briefing-push: already succeeded, skipping duplicate"
    );
    return "skippedSucceeded";
  }

  if (existing?.pushStatus === "failed") {
    logger.info(
      { briefingId, targetId: target.id, attemptCount: existing.attemptCount },
      "briefing-push: failed row not auto-retried on tick"
    );
    return "skippedClaimed";
  }

  if (existing?.pushStatus === "pending") {
    const marked = await markStalePendingFailed(existing.id);
    if (marked) {
      // Only first converter alerts once.
      logger.error(
        {
          briefingId,
          targetId: target.id,
          claimId: existing.id,
          code: STALE_PENDING_ERROR,
        },
        "briefing-push: stale pending marked failed (delivery unknown); requires manual repush"
      );
    } else {
      logger.info(
        { briefingId, targetId: target.id, claimId: existing.id },
        "briefing-push: pending still leased or already handled, not sending"
      );
    }
    return "skippedClaimed";
  }

  logger.info(
    { briefingId, targetId: target.id, existingStatus: existing?.pushStatus ?? null },
    "briefing-push: claim lost with unknown state, not sending"
  );
  return "skippedClaimed";
}

/**
 * Manual path for a single target: INSERT, or reclaim failed/stale, then send.
 * succeeded rows are never force-resent.
 */
async function processTargetManual(
  briefingId: number,
  target: TargetRow,
  card: CardPayload,
  sleepFn: (ms: number) => Promise<void>
): Promise<"succeeded" | "failed" | "skippedSucceeded" | "skippedClaimed"> {
  const claimed = await insertClaim(briefingId, target.id);
  if (claimed) {
    const outcome = await sendWithCas(target, card, claimed, {
      sleepFn,
      firstAttemptAlreadyAuthorized: false,
    });
    if (outcome === "succeeded") return "succeeded";
    if (outcome === "failed") return "failed";
    return "skippedClaimed";
  }

  const existing = await loadExistingPush(briefingId, target.id);
  if (existing?.pushStatus === "succeeded") {
    logger.info(
      { briefingId, targetId: target.id },
      "briefing-push manual: already succeeded, no force resend"
    );
    return "skippedSucceeded";
  }

  if (!existing) {
    logger.info({ briefingId, targetId: target.id }, "briefing-push manual: claim lost, no row");
    return "skippedClaimed";
  }

  // failed or (possibly) stale pending — atomic reclaim + first authorize.
  if (existing.pushStatus === "failed" || existing.pushStatus === "pending") {
    const newAttempt = await reclaimFailedOrStale(existing.id);
    if (newAttempt == null) {
      logger.info(
        { briefingId, targetId: target.id, claimId: existing.id, status: existing.pushStatus },
        "briefing-push manual: reclaim lost (concurrent or not reclaimable)"
      );
      return "skippedClaimed";
    }
    const outcome = await sendWithCas(
      target,
      card,
      { id: existing.id, expectedAttemptCount: newAttempt },
      {
        sleepFn,
        firstAttemptAlreadyAuthorized: true,
      }
    );
    if (outcome === "succeeded") return "succeeded";
    if (outcome === "failed") return "failed";
    return "skippedClaimed";
  }

  return "skippedClaimed";
}

/**
 * Early-exit probe: one round-trip listing active targets joined to succeeded pushes.
 * All succeeded → skip without loading card body.
 */
async function allActiveTargetsSucceeded(briefingId: number): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({
      targetId: briefingTargets.id,
      succeededPushId: briefingPushes.id,
    })
    .from(briefingTargets)
    .leftJoin(
      briefingPushes,
      and(
        eq(briefingPushes.targetId, briefingTargets.id),
        eq(briefingPushes.briefingId, briefingId),
        eq(briefingPushes.pushStatus, "succeeded")
      )
    )
    .where(and(eq(briefingTargets.enabled, true), isNull(briefingTargets.disabledAt)));

  if (rows.length === 0) return false;
  return rows.every((r) => r.succeededPushId != null);
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

/**
 * Build actionCard text from briefing payload.
 * Extracts key fields for the DingTalk summary card.
 */
function buildCardText(briefing: BriefingRow): string {
  const payload = briefing.payloadJson as Record<string, unknown> | null;
  const dateStr = briefing.briefingDate;

  const lines: string[] = [`## 远东·铜锂行情简报 · ${dateStr}`, ""];

  if (payload) {
    const cu = payload["cu"] as Record<string, unknown> | undefined;
    const lc = payload["lc"] as Record<string, unknown> | undefined;
    const macro = payload["macro_summary"] as string | undefined;
    const advice = payload["procurement_advice"] as string | undefined;

    if (cu) {
      const outlook = cu["outlook"] as Record<string, unknown> | undefined;
      const trend = outlook?.["trend"] as string | undefined;
      if (trend) lines.push(`铜：${trend}`);
    }
    if (lc) {
      const outlook = lc["outlook"] as Record<string, unknown> | undefined;
      const trend = outlook?.["trend"] as string | undefined;
      if (trend) lines.push(`锂：${trend}`);
    }
    if (macro) {
      lines.push("", `宏观：${macro}`);
    }
    if (advice) {
      lines.push("", `采购建议：${advice}`);
    }
  }

  lines.push("", "详情见站内简报。");
  return lines.join("\n");
}

function buildCard(briefing: BriefingRow, baseUrl: string): CardPayload {
  return {
    title: `远东·铜锂行情简报 · ${briefing.briefingDate}`,
    text: buildCardText(briefing),
    btns: [{ title: "查看完整简报", actionURL: `${baseUrl}/briefing/${briefing.id}` }],
  };
}

async function pushToAllTargets(
  briefingId: number,
  targets: TargetRow[],
  card: CardPayload,
  sleepFn: (ms: number) => Promise<void>,
  mode: "scheduled" | "manual"
): Promise<BriefingPushResult> {
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
            ? await processTargetScheduled(briefingId, target, card, sleepFn)
            : await processTargetManual(briefingId, target, card, sleepFn);
        if (outcome === "succeeded") succeeded++;
        else if (outcome === "failed") failed++;
        else if (outcome === "skippedSucceeded") skippedSucceeded++;
        else skippedClaimed++;
      })
    )
  );

  logger.info(
    { briefingId, mode, succeeded, failed, skippedSucceeded, skippedClaimed },
    "briefing-push: completed"
  );

  return {
    briefingId,
    skipped: false,
    succeeded,
    failed,
    skippedSucceeded,
    skippedClaimed,
  };
}

/**
 * Push a commodity briefing to all active targets with CAS claim-first.
 * `mode: "scheduled"` never reclaim/re-sends failed; `mode: "manual"` may.
 */
export async function runBriefingPush(
  briefingId: number,
  options: RunBriefingPushOptions = {}
): Promise<BriefingPushResult> {
  const mode = options.mode ?? "manual";
  const sleepFn = options.sleepFn ?? sleep;
  const db = getDb();

  // --- load briefing first ---
  // Manual business-day gate needs briefing.briefingDate; not-found must short-circuit
  // before holiday checks so reason stays "briefing_not_found".
  const [briefing] = await db
    .select({
      id: commodityBriefings.id,
      briefingDate: commodityBriefings.briefingDate,
      payloadJson: commodityBriefings.payloadJson,
    })
    .from(commodityBriefings)
    .where(eq(commodityBriefings.id, briefingId))
    .limit(1);

  if (!briefing) {
    logger.warn({ briefingId }, "briefing-push: briefing not found");
    return emptyResult({ briefingId, skipped: true, reason: "briefing_not_found" });
  }

  // --- holiday / business-day check (after briefing is known) ---
  // scheduled: single-clock reportDate from scheduler (spec §5).
  // manual: briefing's own date — never request-time wall clock (spec §5 manual repush).
  const holidaySet = await loadHolidaySet();
  const businessDayInput: Date | string =
    mode === "scheduled" && options.reportDate
      ? options.reportDate
      : briefing.briefingDate;
  if (!isBusinessDay(businessDayInput, holidaySet)) {
    logger.info(
      { briefingId, mode, businessDayInput },
      "briefing-push skipped: not a business day"
    );
    return emptyResult({
      briefingId,
      skipped: true,
      reason: "not_business_day",
    });
  }

  // Early exit (≤1 RT after holiday/briefing): do not load card or enter send loop.
  if (await allActiveTargetsSucceeded(briefingId)) {
    logger.info({ briefingId }, "briefing-push skipped: all active targets already succeeded");
    return emptyResult({
      briefingId,
      skipped: true,
      reason: "all_targets_succeeded",
    });
  }

  // --- load active targets: enabled=true AND disabled_at IS NULL ---
  const targets = await loadActiveTargets();

  if (targets.length === 0) {
    logger.info({ briefingId }, "briefing-push: no active targets, skipping");
    return emptyResult({ briefingId, skipped: true, reason: "no_targets" });
  }

  // Manual repush passes no baseUrl. Fall back to the same daily_push_config.base_url
  // the scheduled path uses, then to env — stack 89 sets neither INTRANET_URL nor
  // NEXT_PUBLIC_APP_URL, so the bare env default is a dead link.
  let cardBaseUrl = options.baseUrl;
  if (!cardBaseUrl) {
    const [cfg] = await db
      .select({ baseUrl: dailyPushConfig.baseUrl })
      .from(dailyPushConfig)
      .where(eq(dailyPushConfig.id, 1))
      .limit(1);
    cardBaseUrl = cfg?.baseUrl ?? INTRANET_BASE_URL;
  }

  const card = buildCard(briefing, cardBaseUrl);

  logger.info(
    { briefingId, targetCount: targets.length, cardBaseUrl, mode },
    "briefing-push: starting push"
  );

  return pushToAllTargets(briefingId, targets, card, sleepFn, mode);
}

/**
 * Scheduled 铜锂日报 push — migration 0060 split it off the 产业日报 card.
 *
 * Rides the same minute tick as runScheduledDailyPush but gates on
 * daily_push_config.briefing_send_time, so the two reports go out at their own
 * times (产业日报 09:00 / 铜锂日报 17:00 by default) as separate cards.
 * `enabled` is the shared kill switch for both.
 *
 * CAS claim-first (T17b): failed rows are NOT auto-retried on later ticks.
 * Manual repush is the only reclaim path.
 */
export async function runScheduledBriefingPush(
  options: RunScheduledBriefingPushOptions = {}
): Promise<{ skipped: boolean; reason?: string; briefingId?: number }> {
  const sleepFn = options.sleepFn ?? sleep;
  // Single Asia/Shanghai conversion for this invocation (spec §5).
  const now = options.now ? dayjs(options.now).tz(APP_TIMEZONE) : dayjs().tz(APP_TIMEZONE);
  const reportDate = now.format("YYYY-MM-DD");
  const currentHm = now.format("HH:mm");
  const db = getDb();

  const [config] = await db
    .select({
      enabled: dailyPushConfig.enabled,
      briefingSendTime: dailyPushConfig.briefingSendTime,
      baseUrl: dailyPushConfig.baseUrl,
    })
    .from(dailyPushConfig)
    .where(eq(dailyPushConfig.id, 1))
    .limit(1);

  if (!config) {
    logger.info({ reportDate }, "briefing-push skipped: config row missing");
    return { skipped: true, reason: "config_missing" };
  }
  if (!config.enabled) {
    logger.info(
      { reportDate, briefingSendTime: config.briefingSendTime },
      "briefing-push skipped: disabled"
    );
    return { skipped: true, reason: "disabled" };
  }
  // Same `>=` reasoning as daily-push: an exact-minute gate loses to slow generation.
  if (currentHm < config.briefingSendTime) {
    logger.info(
      { reportDate, briefingSendTime: config.briefingSendTime, currentHm },
      "briefing-push skipped: before briefing_send_time"
    );
    return { skipped: true, reason: "before_send_time" };
  }

  const briefingId = await scheduleLatestBriefingPush(reportDate);
  if (briefingId == null) return { skipped: true, reason: "no_briefing" };

  // Pass the same reportDate into runBriefingPush so holiday gate shares one clock.
  const result = await runBriefingPush(briefingId, {
    baseUrl: config.baseUrl,
    mode: "scheduled",
    reportDate,
    sleepFn,
  });
  return { skipped: result.skipped, reason: result.reason, briefingId };
}

/**
 * Resolve the pushable commodity briefing id for a given reportDate
 * (succeeded/degraded). Used by runScheduledBriefingPush; manual repush passes
 * an explicit positive briefingId to runBriefingPush instead.
 *
 * Must not sample wall clock — reportDate is the single-clock value from the
 * scheduler (spec §5).
 */
export async function scheduleLatestBriefingPush(
  reportDate: string
): Promise<number | null> {
  const db = getDb();

  const [latest] = await db
    .select({ id: commodityBriefings.id, genStatus: commodityBriefings.genStatus })
    .from(commodityBriefings)
    .where(eq(commodityBriefings.briefingDate, reportDate))
    .limit(1);

  if (!latest) {
    logger.info({ date: reportDate }, "briefing-push: no briefing found for date");
    return null;
  }

  if (latest.genStatus !== "succeeded" && latest.genStatus !== "degraded") {
    logger.warn(
      { briefingId: latest.id, genStatus: latest.genStatus },
      "briefing-push: briefing not in pushable state"
    );
    return null;
  }

  logger.info(
    { briefingId: latest.id, reportDate },
    "briefing-push: resolved pushable briefing for date"
  );
  return latest.id;
}
