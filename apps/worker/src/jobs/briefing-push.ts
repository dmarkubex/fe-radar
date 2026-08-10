import { eq, and, isNull } from "drizzle-orm";
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
import { APP_TIMEZONE, createLogger, dayjs, nowInAppTimezone } from "@fe-radar/shared";
import { sendActionCard } from "../lib/dingtalk-bot";

const logger = createLogger({ service: "briefing-push" });

/** Concurrency limit for DingTalk webhook calls (avoids single-IP rate limit). */
const PUSH_CONCURRENCY = 3;

/** Exponential backoff delays in ms: 1s / 4s / 16s (×1 ×4 ×16). */
const RETRY_DELAYS_MS = [1_000, 4_000, 16_000] as const;

/** Max push attempts per target (3 retries = 3 total after initial fail, but we do up to 3 total). */
const MAX_ATTEMPTS = 3;

const INTRANET_BASE_URL =
  process.env["INTRANET_URL"] ??
  process.env["NEXT_PUBLIC_APP_URL"] ??
  "http://fe-radar.internal";

async function loadHolidaySet(): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ holidayDate: briefingHolidays.holidayDate })
    .from(briefingHolidays);
  return new Set(rows.map((r) => r.holidayDate as string));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BriefingPushResult {
  briefingId: number;
  succeeded: number;
  failed: number;
  skipped: boolean;
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

/**
 * Push briefing to a single target with exponential backoff retry.
 * Returns { ok: true } on success, { ok: false, error } after exhausting attempts.
 */
async function pushToTarget(
  briefing: BriefingRow,
  target: TargetRow,
  baseUrl: string = INTRANET_BASE_URL
): Promise<{ ok: boolean; attempts: number; error?: string }> {
  const title = `远东·铜锂行情简报 · ${briefing.briefingDate}`;
  const text = buildCardText(briefing);
  const actionURL = `${baseUrl}/briefing/${briefing.id}`;

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await sendActionCard(
        target.webhookUrl,
        target.signSecret ?? "",
        {
          title,
          text,
          btns: [{ title: "查看完整简报", actionURL }],
        }
      );
      return { ok: true, attempts: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn(
        { targetId: target.id, targetName: target.name, attempt, err: lastError },
        "briefing-push: attempt failed"
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 1_000);
      }
    }
  }

  return { ok: false, attempts: MAX_ATTEMPTS, error: lastError };
}

export async function runBriefingPush(
  briefingId: number,
  /** Card deep-link host; scheduled path passes daily_push_config.base_url. */
  baseUrl?: string
): Promise<BriefingPushResult> {
  const now = new Date();

  // --- holiday check ---
  const holidaySet = await loadHolidaySet();
  if (!isBusinessDay(now, holidaySet)) {
    logger.info({ briefingId }, "briefing-push skipped: not a business day");
    return { briefingId, succeeded: 0, failed: 0, skipped: true };
  }

  const db = getDb();

  // --- load briefing ---
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
    return { briefingId, succeeded: 0, failed: 0, skipped: true };
  }

  // --- load active targets: enabled=true AND disabled_at IS NULL ---
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
    logger.info({ briefingId }, "briefing-push: no active targets, skipping");
    return { briefingId, succeeded: 0, failed: 0, skipped: true };
  }

  // Manual repush passes no baseUrl. Fall back to the same daily_push_config.base_url
  // the scheduled path uses, then to env — stack 89 sets neither INTRANET_URL nor
  // NEXT_PUBLIC_APP_URL, so the bare env default is a dead link.
  let cardBaseUrl = baseUrl;
  if (!cardBaseUrl) {
    const [cfg] = await db
      .select({ baseUrl: dailyPushConfig.baseUrl })
      .from(dailyPushConfig)
      .where(eq(dailyPushConfig.id, 1))
      .limit(1);
    cardBaseUrl = cfg?.baseUrl ?? INTRANET_BASE_URL;
  }

  logger.info(
    { briefingId, targetCount: targets.length, cardBaseUrl },
    "briefing-push: starting push"
  );

  // --- concurrency-limited push with p-limit ---
  const limit = pLimit(PUSH_CONCURRENCY);
  let succeeded = 0;
  let failed = 0;

  await Promise.all(
    targets.map((target) =>
      limit(async () => {
        // Skip if already succeeded for this (briefing_id, target_id) pair
        const [existing] = await db
          .select({ pushStatus: briefingPushes.pushStatus })
          .from(briefingPushes)
          .where(
            and(
              eq(briefingPushes.briefingId, briefingId),
              eq(briefingPushes.targetId, target.id)
            )
          )
          .limit(1);

        if (existing?.pushStatus === "succeeded") {
          logger.info(
            { briefingId, targetId: target.id },
            "briefing-push: already succeeded, skipping duplicate"
          );
          succeeded++;
          return;
        }

        const result = await pushToTarget(briefing, target, cardBaseUrl);
        const pushStatus = result.ok ? "succeeded" : "failed";
        const pushedAt = result.ok ? new Date() : null;

        if (result.ok) {
          succeeded++;
        } else {
          failed++;
          logger.error(
            { briefingId, targetId: target.id, targetName: target.name, error: result.error },
            "briefing-push: target failed after all retries"
          );
        }

        // Upsert push record
        await db
          .insert(briefingPushes)
          .values({
            briefingId,
            targetId: target.id,
            pushStatus,
            attemptCount: result.attempts,
            errorDetail: result.error ?? null,
            pushedAt,
          })
          .onConflictDoUpdate({
            target: [briefingPushes.briefingId, briefingPushes.targetId],
            set: {
              pushStatus,
              attemptCount: result.attempts,
              errorDetail: result.error ?? null,
              pushedAt,
            },
          });
      })
    )
  );

  logger.info({ briefingId, succeeded, failed }, "briefing-push: completed");
  return { briefingId, succeeded, failed, skipped: false };
}

/**
 * Scheduled 铜锂日报 push — migration 0060 split it off the 产业日报 card.
 *
 * Rides the same minute tick as runScheduledDailyPush but gates on
 * daily_push_config.briefing_send_time, so the two reports go out at their own
 * times (产业日报 09:00 / 铜锂日报 17:00 by default) as separate cards.
 * `enabled` is the shared kill switch for both.
 *
 * ponytail: runBriefingPush is check-then-send, not claim-first like daily-push.
 * Safe here only because the fe-briefing-push worker runs concurrency:1 in a
 * single container — a second worker replica could double-send. Upgrade path:
 * copy daily-push's INSERT ... ON CONFLICT DO NOTHING RETURNING claim.
 * A `failed` row deliberately keeps retrying on later ticks until midnight,
 * which is how a transient DingTalk outage self-heals.
 */
export async function runScheduledBriefingPush(
  options: { now?: Date } = {}
): Promise<{ skipped: boolean; reason?: string; briefingId?: number }> {
  const now = options.now ? dayjs(options.now).tz(APP_TIMEZONE) : dayjs().tz(APP_TIMEZONE);
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
    logger.info({}, "briefing-push skipped: config row missing");
    return { skipped: true, reason: "config_missing" };
  }
  if (!config.enabled) {
    logger.info({ briefingSendTime: config.briefingSendTime }, "briefing-push skipped: disabled");
    return { skipped: true, reason: "disabled" };
  }
  // Same `>=` reasoning as daily-push: an exact-minute gate loses to slow generation.
  if (currentHm < config.briefingSendTime) {
    logger.info(
      { briefingSendTime: config.briefingSendTime, currentHm },
      "briefing-push skipped: before briefing_send_time"
    );
    return { skipped: true, reason: "before_send_time" };
  }

  const briefingId = await scheduleLatestBriefingPush();
  if (briefingId == null) return { skipped: true, reason: "no_briefing" };

  // runBriefingPush does its own holiday gate and per-target dedup.
  const result = await runBriefingPush(briefingId, config.baseUrl);
  return { skipped: result.skipped, briefingId };
}

/**
 * Resolve today's pushable commodity briefing id (succeeded/degraded).
 * Used by runScheduledBriefingPush; manual repush passes an explicit positive
 * briefingId to runBriefingPush instead.
 */
export async function scheduleLatestBriefingPush(): Promise<number | null> {
  const db = getDb();

  // Use today's date in Asia/Shanghai
  const todayStr = nowInAppTimezone().format("YYYY-MM-DD");

  const [latest] = await db
    .select({ id: commodityBriefings.id, genStatus: commodityBriefings.genStatus })
    .from(commodityBriefings)
    .where(eq(commodityBriefings.briefingDate, todayStr))
    .limit(1);

  if (!latest) {
    logger.info({ date: todayStr }, "briefing-push: no briefing found for today");
    return null;
  }

  if (latest.genStatus !== "succeeded" && latest.genStatus !== "degraded") {
    logger.warn(
      { briefingId: latest.id, genStatus: latest.genStatus },
      "briefing-push: briefing not in pushable state"
    );
    return null;
  }

  logger.info({ briefingId: latest.id }, "briefing-push: resolved today's pushable briefing");
  return latest.id;
}
