/**
 * POST /api/briefing/daily/[reportDate]/repush — admin manual repush for 产业日报 (T17a).
 *
 * Auth: fresh admin. Validates calendar date, report content, business day;
 * enqueues daily-repush job. Does NOT claim in Web layer (claim stays in worker).
 */

import { eq } from "drizzle-orm";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getDb, dailyPushConfig, dailyReports, briefingHolidays } from "@fe-radar/db";
import { hasDailyContent, isBusinessDay } from "@fe-radar/core";
import type { DailyReportSections } from "@fe-radar/core";
import { getRequestUser, requireFreshRole } from "@/lib/api/authz";
import { hasRole } from "@/lib/auth/rbac";

import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ reportDate: string }>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict calendar date (rejects 2026-02-30 etc.). */
function isValidCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [ys, ms, ds] = value.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const freshError = await requireFreshRole(request, "admin");
  if (freshError) return freshError;
  const user = await getRequestUser(request);
  if (!user.role) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
  }
  if (!hasRole(user.role, "admin")) {
    return Response.json({ error: { code: "FORBIDDEN", message: "权限不足" } }, { status: 403 });
  }

  const { reportDate } = await context.params;
  if (!isValidCalendarDate(reportDate)) {
    return Response.json(
      { error: { code: "INVALID_REPORT_DATE", message: "reportDate 必须是合法 YYYY-MM-DD 日历日期" } },
      { status: 400 }
    );
  }

  const db = getDb();

  const [dailyRow] = await db
    .select({
      date: dailyReports.date,
      sections: dailyReports.sections,
    })
    .from(dailyReports)
    .where(eq(dailyReports.date, reportDate))
    .limit(1);

  if (!hasDailyContent(dailyRow?.sections as DailyReportSections | null | undefined)) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "该日期产业日报不存在或无有效内容" } },
      { status: 404 }
    );
  }

  const [config] = await db
    .select({
      scheduleMode: dailyPushConfig.scheduleMode,
    })
    .from(dailyPushConfig)
    .where(eq(dailyPushConfig.id, 1))
    .limit(1);

  if (config?.scheduleMode === "business_days") {
    const holidays = await db
      .select({ holidayDate: briefingHolidays.holidayDate })
      .from(briefingHolidays);
    const holidaySet = new Set(holidays.map((h) => h.holidayDate as string));
    if (!isBusinessDay(reportDate, holidaySet)) {
      return Response.json(
        {
          error: {
            code: "REPORT_DATE_NOT_BUSINESS_DAY",
            message: "该日期为节假日/非工作日，无法重推产业日报",
          },
        },
        { status: 422 }
      );
    }
  }

  const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  try {
    const queue = new Queue("fe-briefing-push", { connection });
    await queue.add(
      "daily-repush",
      {
        kind: "daily-repush",
        reportDate,
        trigger: "manual" as const,
      },
      // Distinct jobId per enqueue is OK; DB claim enforces single sender per target.
      { jobId: `daily-repush-${reportDate}-${Date.now()}` }
    );
  } finally {
    await connection.quit();
  }

  return Response.json({ ok: true, reportDate }, { status: 202 });
}
