import { and, count, eq, gte, isNull } from "drizzle-orm";
import { briefingHolidays, briefingTargets, getDb, itemAnalysis, items } from "@fe-radar/db";
import { isBusinessDay } from "@fe-radar/core";
import { APP_TIMEZONE, createLogger, dayjs } from "@fe-radar/shared";

import type { DbClient } from "@fe-radar/db";
import { sendActionCard } from "../lib/dingtalk-bot";
import { dailyInputSince, loadDailyInput } from "./daily-gen";

const logger = createLogger({ service: "health-check" });

export const OPS_ALERT_NO_TARGET = "OPS_ALERT_NO_TARGET";

const TIMELINE_URL = "http://fe-radar.internal/";

export interface HealthCheckResult {
  skipped: boolean;
  reason?: string;
  date: string;
  curatedCount: number;
  fetchedCount: number;
  scoredCount: number;
  alerted: boolean;
  targetCount: number;
}

export interface HealthCheckLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface HealthCheckDeps {
  db?: DbClient;
  now?: Date;
  sendActionCardFn?: typeof sendActionCard;
  loadDailyInputFn?: typeof loadDailyInput;
  logger?: HealthCheckLogger;
}

export interface HealthAlertCard {
  title: string;
  text: string;
  btns: Array<{ title: string; actionURL: string }>;
}

export function buildHealthAlertCard(input: {
  date: string;
  curatedCount: number;
  fetchedCount: number;
  scoredCount: number;
}): HealthAlertCard {
  const { date, curatedCount, fetchedCount, scoredCount } = input;
  return {
    title: `【严重】情报断流：${date} 过去24h精选条目为 ${curatedCount}`,
    text: [
      "## 情报断流告警",
      "",
      `- 检查日期：${date}`,
      `- 过去24h精选条目：${curatedCount}`,
      `- 过去24h入库条目：${fetchedCount}`,
      `- 过去24h已评分条目：${scoredCount}`,
      "",
      diagnose(fetchedCount, scoredCount)
    ].join("\n"),
    btns: [{ title: "查看时间线", actionURL: TIMELINE_URL }]
  };
}

function diagnose(fetchedCount: number, scoredCount: number): string {
  if (fetchedCount === 0) {
    return "入库为 0，抓取可能已断流。";
  }
  if (scoredCount === 0) {
    return "有入库但未评分，pipeline 可能卡住。";
  }
  return "抓取与评分正常，但没有条目过精选阈值。";
}

function emptyResult(
  date: string,
  partial: Partial<HealthCheckResult> & { skipped: boolean }
): HealthCheckResult {
  return {
    date,
    curatedCount: 0,
    fetchedCount: 0,
    scoredCount: 0,
    alerted: false,
    targetCount: 0,
    ...partial
  };
}

async function loadHolidaySet(db: DbClient): Promise<Set<string>> {
  const rows = await db
    .select({ holidayDate: briefingHolidays.holidayDate })
    .from(briefingHolidays);
  return new Set(rows.map((row) => row.holidayDate as string));
}

async function loadOpsAlertTargets(db: DbClient): Promise<Array<{
  webhookUrl: string;
  signSecret: string | null;
}>> {
  return db
    .select({
      webhookUrl: briefingTargets.webhookUrl,
      signSecret: briefingTargets.signSecret
    })
    .from(briefingTargets)
    .where(and(
      eq(briefingTargets.opsAlertEnabled, true),
      eq(briefingTargets.enabled, true),
      isNull(briefingTargets.disabledAt)
    ));
}

export async function runHealthCheck(options: HealthCheckDeps = {}): Promise<HealthCheckResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? dayjs().tz(APP_TIMEZONE).toDate();
  const send = options.sendActionCardFn ?? sendActionCard;
  const loadInput = options.loadDailyInputFn ?? loadDailyInput;
  const log = options.logger ?? logger;
  const date = dayjs(now).tz(APP_TIMEZONE).format("YYYY-MM-DD");

  try {
    const holidaySet = await loadHolidaySet(db);
    if (!isBusinessDay(date, holidaySet)) {
      const result = emptyResult(date, { skipped: true, reason: "not_business_day" });
      log.info({ date, reason: result.reason }, "health check skipped");
      return result;
    }

    const since = dailyInputSince(now);
    const curatedItems = await loadInput(db, now);
    const curatedCount = curatedItems.length;
    const [fetchedRow] = await db
      .select({ count: count() })
      .from(items)
      .where(gte(items.fetchedAt, since));
    const [scoredRow] = await db
      .select({ count: count() })
      .from(itemAnalysis)
      .where(gte(itemAnalysis.scoredAt, since));
    const fetchedCount = Number(fetchedRow?.count ?? 0);
    const scoredCount = Number(scoredRow?.count ?? 0);
    const targets = await loadOpsAlertTargets(db);
    const targetCount = targets.length;

    if (targetCount === 0) {
      log.error({ code: OPS_ALERT_NO_TARGET, date }, "ops alert has no target");
      const result = {
        skipped: false,
        date,
        curatedCount,
        fetchedCount,
        scoredCount,
        alerted: false,
        targetCount
      };
      log.info({ date, curatedCount, fetchedCount, scoredCount, alerted: false, targetCount }, "health check completed");
      return result;
    }

    let alerted = false;
    if (curatedCount === 0) {
      const card = buildHealthAlertCard({ date, curatedCount, fetchedCount, scoredCount });
      for (const target of targets) {
        await send(target.webhookUrl, target.signSecret ?? "", card);
      }
      alerted = true;
    }

    const result = {
      skipped: false,
      date,
      curatedCount,
      fetchedCount,
      scoredCount,
      alerted,
      targetCount
    };
    log.info({ date, curatedCount, fetchedCount, scoredCount, alerted, targetCount }, "health check completed");
    return result;
  } catch (err) {
    log.error({ err, date }, "health check failed");
    return emptyResult(date, { skipped: false, reason: "error" });
  }
}
