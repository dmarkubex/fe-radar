import { and, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
import { hasDailyContent } from "@fe-radar/core";
import { dailyReports, getDb, itemAnalysis, items, sources } from "@fe-radar/db";
import { APP_TIMEZONE, createLogger, dayjs, LlmError } from "@fe-radar/shared";
import { assertKimiContext, DAILY_REPORT_SCHEMA, DAILY_REPORT_SYSTEM_PROMPT, withScrubber } from "@fe-radar/llm";
import { loadProjectCodes } from "../handlers/context";

import type { DbClient } from "@fe-radar/db";
import type { DailyReportResult, LlmClient } from "@fe-radar/llm";

const logger = createLogger({ service: "daily-gen" });

export const DAILY_REPORT_CRON = "0 8 * * *";
export const DAILY_REPORT_TZ = APP_TIMEZONE;
export const DAILY_REPORT_BLOCKED_SUMMARY = "[需人工脱敏]";

export interface DailyInputItem {
  title: string;
  sourceName: string;
  category: string | null;
  summaryZh: string | null;
  scoredAt: Date | null;
  publishedAt: Date | null;
}

export function buildDailyReportInput(itemsForReport: DailyInputItem[]): string {
  return itemsForReport
    .map((item, index) => [
      `#${index + 1}`,
      `标题：${item.title}`,
      `信源：${item.sourceName}`,
      `分类：${item.category ?? "未分类"}`,
      `发布时间：${item.publishedAt ? dayjs(item.publishedAt).tz(APP_TIMEZONE).format("YYYY-MM-DD HH:mm") : "-"}`,
      `评分时间：${item.scoredAt ? dayjs(item.scoredAt).tz(APP_TIMEZONE).format("YYYY-MM-DD HH:mm") : "-"}`,
      `摘要：${item.summaryZh ?? ""}`
    ].join("\n"))
    .join("\n\n");
}

/** Rolling 24h scoredAt window used by daily-gen and health-check fetch/score counts. Do not fork a second scoredAt clock. */
export function dailyInputSince(now = dayjs().tz(APP_TIMEZONE).toDate()): Date {
  return dayjs(now).tz(APP_TIMEZONE).subtract(24, "hour").toDate();
}

/** Calendar time-chain: start of previous day in Asia/Shanghai. Independent of scoredAt. */
export function dailyPublishedSince(now = dayjs().tz(APP_TIMEZONE).toDate()): Date {
  return dayjs(now).tz(APP_TIMEZONE).startOf("day").subtract(1, "day").toDate();
}

export async function loadDailyInput(db: DbClient = getDb(), now = dayjs().tz(APP_TIMEZONE).toDate()): Promise<DailyInputItem[]> {
  const scoredSince = dailyInputSince(now);
  const publishedSince = dailyPublishedSince(now);
  return db
    .select({
      title: items.title,
      sourceName: sources.name,
      category: itemAnalysis.category,
      summaryZh: itemAnalysis.summaryZh,
      scoredAt: itemAnalysis.scoredAt,
      publishedAt: items.publishedAt
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .innerJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id))
    .where(and(
      eq(itemAnalysis.isCurated, true),
      gte(itemAnalysis.scoredAt, scoredSince),
      gte(items.publishedAt, publishedSince),
      isNotNull(itemAnalysis.summaryZh),
      ne(itemAnalysis.summaryZh, "")
    ))
    .orderBy(sql`${itemAnalysis.qualityScore} desc nulls last`)
    .limit(200);
}

export async function runDailyGen(kimi: LlmClient, options: { db?: DbClient; now?: Date } = {}): Promise<DailyReportResult | null> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const reportDate = dayjs(now).tz(APP_TIMEZONE).format("YYYY-MM-DD");
  const inputItems = await loadDailyInput(db, now);
  if (inputItems.length === 0) {
    logger.info({ reportDate, inputCount: 0 }, "daily-gen skipped: no curated items in window");
    return null;
  }

  const blockedCount = inputItems.filter((item) => item.summaryZh === DAILY_REPORT_BLOCKED_SUMMARY).length;
  if (blockedCount >= 5) {
    throw new LlmError("DAILY_REPORT_BLOCKED", "Daily report paused because too many items need manual scrub", { blockedCount });
  }

  const user = buildDailyReportInput(inputItems);
  assertKimiContext(user);
  // T-SEC-09: 注入项目代号字典（job 内即时加载，缓存命中便宜）。
  const projectCodes = await loadProjectCodes();
  const client = withScrubber(kimi, { blockThreshold: 3, projectCodes });
  const result = await client.chatJson<DailyReportResult>({
    system: DAILY_REPORT_SYSTEM_PROMPT,
    user,
    schemaName: "daily_report",
    schema: DAILY_REPORT_SCHEMA
  });

  if (!hasDailyContent(result.value.sections)) {
    logger.info({ reportDate }, "daily-gen skipped: llm returned empty sections");
    return null;
  }

  await db
    .insert(dailyReports)
    .values({ date: reportDate, sections: result.value.sections })
    .onConflictDoUpdate({
      target: dailyReports.date,
      set: {
        sections: result.value.sections,
        generatedAt: new Date()
      }
    });

  return result.value;
}
