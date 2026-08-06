/**
 * Scheduled unified daily push — T-DUP-02
 *
 * Minute tick (briefingId=0 sentinel) reads daily_push_config and, when the
 * configured HH:mm hits, sends one merged ActionCard per active briefing_target.
 * Manual positive briefingId jobs stay on runBriefingPush (briefing-only repush).
 *
 * Gate-B: claim row with INSERT pending + ON CONFLICT DO NOTHING RETURNING before
 * any webhook call; only the worker that receives a row may send.
 */

import { and, eq, isNull } from "drizzle-orm";
import pLimit from "p-limit";
import {
  getDb,
  dailyPushConfig,
  dailyPushes,
  dailyReports,
  commodityBriefings,
  briefingTargets,
  briefingHolidays,
} from "@fe-radar/db";
import { buildDailyPushCard, hasDailyContent, isBusinessDay } from "@fe-radar/core";
import type { BriefingCardPayload, DailyReportSections } from "@fe-radar/core";
import { APP_TIMEZONE, createLogger, dayjs } from "@fe-radar/shared";
import { sendActionCard } from "../lib/dingtalk-bot";

const logger = createLogger({ service: "daily-push" });

const PUSH_CONCURRENCY = 3;
const RETRY_DELAYS_MS = [1_000, 4_000, 16_000] as const;
const MAX_ATTEMPTS = 3;

export interface DailyPushResult {
  skipped: boolean;
  reason?: string;
  reportDate?: string;
  succeeded: number;
  failed: number;
  skippedSucceeded: number;
  /** Claim lost to concurrent worker / existing row (not re-sent). */
  skippedClaimed: number;
}

export interface RunScheduledDailyPushOptions {
  /** Injected clock for tests; defaults to now. */
  now?: Date;
  /** Injected sleep for tests. */
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

async function pushCardToTarget(
  target: TargetRow,
  card: { title: string; text: string; btns: Array<{ title: string; actionURL: string }> },
  sleepFn: (ms: number) => Promise<void>
): Promise<{ ok: boolean; attempts: number; error?: string }> {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await sendActionCard(target.webhookUrl, target.signSecret ?? "", {
        title: card.title,
        text: card.text,
        btns: card.btns,
      });
      return { ok: true, attempts: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn(
        { targetId: target.id, targetName: target.name, attempt, err: lastError },
        "daily-push: attempt failed"
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleepFn(RETRY_DELAYS_MS[attempt - 1] ?? 1_000);
      }
    }
  }
  return { ok: false, attempts: MAX_ATTEMPTS, error: lastError };
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

/**
 * Entry for cron sentinel briefingId=0: read DB schedule and push merged cards.
 */
export async function runScheduledDailyPush(
  options: RunScheduledDailyPushOptions = {}
): Promise<DailyPushResult> {
  const sleepFn = options.sleepFn ?? sleep;
  const now = options.now ? dayjs(options.now).tz(APP_TIMEZONE) : dayjs().tz(APP_TIMEZONE);
  const reportDate = now.format("YYYY-MM-DD");
  const currentHm = now.format("HH:mm");

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

  if (!config) {
    logger.info({ reportDate }, "daily-push skipped: config row missing");
    return emptyResult({ skipped: true, reason: "config_missing" });
  }

  const cfg = config as ConfigRow;

  if (!cfg.enabled) {
    logger.info({ reportDate, sendTime: cfg.sendTime }, "daily-push skipped: disabled");
    return emptyResult({ skipped: true, reason: "disabled", reportDate });
  }

  if (cfg.sendTime !== currentHm) {
    logger.info(
      { reportDate, sendTime: cfg.sendTime, currentHm },
      "daily-push skipped: time mismatch"
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

  const [dailyRow] = await db
    .select({
      date: dailyReports.date,
      sections: dailyReports.sections,
    })
    .from(dailyReports)
    .where(eq(dailyReports.date, reportDate))
    .limit(1);

  const [briefingRow] = await db
    .select({
      id: commodityBriefings.id,
      genStatus: commodityBriefings.genStatus,
      payloadJson: commodityBriefings.payloadJson,
    })
    .from(commodityBriefings)
    .where(eq(commodityBriefings.briefingDate, reportDate))
    .limit(1);

  // Gate-B minor: empty `{}` is NOT daily present — require a non-empty section body.
  const dailyPresent = hasDailyContent(
    dailyRow?.sections as DailyReportSections | null | undefined
  );
  const briefingPushable =
    briefingRow != null &&
    (briefingRow.genStatus === "succeeded" || briefingRow.genStatus === "degraded");

  if (!dailyPresent && !briefingPushable) {
    logger.info(
      { reportDate, dailyPresent, briefingPresent: Boolean(briefingRow) },
      "daily-push skipped: no content"
    );
    return emptyResult({ skipped: true, reason: "no_content", reportDate });
  }

  const targets = await db
    .select({
      id: briefingTargets.id,
      name: briefingTargets.name,
      webhookUrl: briefingTargets.webhookUrl,
      signSecret: briefingTargets.signSecret,
    })
    .from(briefingTargets)
    .where(and(eq(briefingTargets.enabled, true), isNull(briefingTargets.disabledAt)));

  if (targets.length === 0) {
    logger.info({ reportDate }, "daily-push skipped: no active targets");
    return emptyResult({ skipped: true, reason: "no_targets", reportDate });
  }

  let card: { title: string; text: string; btns: Array<{ title: string; actionURL: string }> };
  try {
    card = buildDailyPushCard({
      reportDate,
      baseUrl: cfg.baseUrl,
      dailySections: dailyPresent
        ? (dailyRow!.sections as DailyReportSections)
        : null,
      briefing: briefingPushable
        ? {
            id: briefingRow!.id,
            genStatus: briefingRow!.genStatus,
            payload: briefingRow!.payloadJson as BriefingCardPayload,
          }
        : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ reportDate, err: message }, "daily-push: card build failed");
    return emptyResult({ skipped: true, reason: "card_build_failed", reportDate });
  }

  logger.info(
    {
      reportDate,
      targetCount: targets.length,
      dailyPresent,
      briefingPresent: briefingPushable,
      briefingId: briefingPushable ? briefingRow!.id : null,
    },
    "daily-push: starting push"
  );

  const limit = pLimit(PUSH_CONCURRENCY);
  let succeeded = 0;
  let failed = 0;
  let skippedSucceeded = 0;
  let skippedClaimed = 0;

  await Promise.all(
    targets.map((target) =>
      limit(async () => {
        // Atomic claim: only the INSERT that returns a row may send the webhook.
        const claimed = await db
          .insert(dailyPushes)
          .values({
            reportDate,
            targetId: target.id,
            briefingId: briefingPushable ? briefingRow!.id : null,
            dailyReportPresent: dailyPresent,
            briefingPresent: briefingPushable,
            pushStatus: "pending",
            attemptCount: 0,
            errorDetail: null,
            pushedAt: null,
          })
          .onConflictDoNothing({
            target: [dailyPushes.reportDate, dailyPushes.targetId],
          })
          .returning({ id: dailyPushes.id });

        const claimId = claimed[0]?.id;
        if (claimId == null) {
          const [existing] = await db
            .select({ pushStatus: dailyPushes.pushStatus })
            .from(dailyPushes)
            .where(
              and(
                eq(dailyPushes.reportDate, reportDate),
                eq(dailyPushes.targetId, target.id)
              )
            )
            .limit(1);

          if (existing?.pushStatus === "succeeded") {
            logger.info(
              { reportDate, targetId: target.id },
              "daily-push: already succeeded, skipping duplicate"
            );
            skippedSucceeded++;
          } else {
            logger.info(
              { reportDate, targetId: target.id, existingStatus: existing?.pushStatus ?? null },
              "daily-push: claim lost (concurrent or prior row), not sending"
            );
            skippedClaimed++;
          }
          return;
        }

        const result = await pushCardToTarget(target, card, sleepFn);
        const pushStatus = result.ok ? "succeeded" : "failed";
        const pushedAt = result.ok ? new Date() : null;

        if (result.ok) {
          succeeded++;
        } else {
          failed++;
          logger.error(
            {
              reportDate,
              targetId: target.id,
              targetName: target.name,
              error: result.error,
            },
            "daily-push: target failed after all retries"
          );
        }

        await db
          .update(dailyPushes)
          .set({
            briefingId: briefingPushable ? briefingRow!.id : null,
            dailyReportPresent: dailyPresent,
            briefingPresent: briefingPushable,
            pushStatus,
            attemptCount: result.attempts,
            errorDetail: result.error ?? null,
            pushedAt,
          })
          .where(eq(dailyPushes.id, claimId));
      })
    )
  );

  logger.info(
    { reportDate, succeeded, failed, skippedSucceeded, skippedClaimed },
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
