import { and, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
import { dailyReports, getDb, itemAnalysis, items, sources } from "@fe-radar/db";
import { APP_TIMEZONE, dayjs, LlmError } from "@fe-radar/shared";
import { assertKimiContext, DAILY_REPORT_SCHEMA, DAILY_REPORT_SYSTEM_PROMPT, withScrubber } from "@fe-radar/llm";
import { loadProjectCodes } from "../handlers/context";

import type { DbClient } from "@fe-radar/db";
import type { DailyReportResult, LlmClient } from "@fe-radar/llm";

export const DAILY_REPORT_CRON = "0 8 * * *";
export const DAILY_REPORT_TZ = APP_TIMEZONE;
export const DAILY_REPORT_BLOCKED_SUMMARY = "[需人工脱敏]";

export interface DailyInputItem {
  title: string;
  sourceName: string;
  category: string | null;
  summaryZh: string | null;
  scoredAt: Date | null;
}

export function buildDailyReportInput(itemsForReport: DailyInputItem[]): string {
  return itemsForReport
    .map((item, index) => [
      `#${index + 1}`,
      `标题：${item.title}`,
      `信源：${item.sourceName}`,
      `分类：${item.category ?? "未分类"}`,
      `评分时间：${item.scoredAt ? dayjs(item.scoredAt).tz(APP_TIMEZONE).format("YYYY-MM-DD HH:mm") : "-"}`,
      `摘要：${item.summaryZh ?? ""}`
    ].join("\n"))
    .join("\n\n");
}

export async function loadDailyInput(db: DbClient = getDb(), now = dayjs().tz(APP_TIMEZONE).toDate()): Promise<DailyInputItem[]> {
  const since = dayjs(now).tz(APP_TIMEZONE).subtract(24, "hour").toDate();
  return db
    .select({
      title: items.title,
      sourceName: sources.name,
      category: itemAnalysis.category,
      summaryZh: itemAnalysis.summaryZh,
      scoredAt: itemAnalysis.scoredAt
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .innerJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id))
    .where(and(eq(itemAnalysis.isCurated, true), gte(itemAnalysis.scoredAt, since), isNotNull(itemAnalysis.summaryZh), ne(itemAnalysis.summaryZh, "")))
    .orderBy(sql`${itemAnalysis.qualityScore} desc nulls last`)
    .limit(200);
}

export async function runDailyGen(kimi: LlmClient, options: { db?: DbClient; now?: Date } = {}): Promise<DailyReportResult> {
  const db = options.db ?? getDb();
  const inputItems = await loadDailyInput(db, options.now);
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

  const reportDate = dayjs(options.now ?? new Date()).tz(APP_TIMEZONE).format("YYYY-MM-DD");
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
