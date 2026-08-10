import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  getDb,
  briefingHolidays,
  commodityBriefings,
  commodityQuotes,
  sources
} from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";
import { getRequestUser } from "@/lib/api/authz";
import { requireFreshViewer } from "@/lib/auth/token-freshness";

import type { NextRequest } from "next/server";

type QuotesDiagnosticCode =
  | "ok"
  | "no_enabled_quotes_source"
  | "business_day_skipped"
  | "no_latest_quote"
  | "generation_failed_with_data";

interface QuotesDiagnostics {
  code: QuotesDiagnosticCode;
  message: string;
  enabledQuotesSources: number;
  today: {
    date: string;
    isBusinessDay: boolean;
    skipReason: "none" | "weekend" | "holiday";
    holidayName: string | null;
  };
  latestQuote: {
    observedAt: string;
    value: number | null;
  } | null;
  todayQuotes: {
    total: number;
    nonNull: number;
  };
  latestBriefing: {
    briefingDate: string;
    genStatus: string;
    genError: string | null;
    generatedAt: string | null;
  } | null;
  failedBriefingQuotes: {
    briefingDate: string;
    total: number;
    nonNull: number;
  } | null;
  generationFailedWithData: boolean;
}

function numericOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildDiagnosticMessage(
  diagnostics: Omit<QuotesDiagnostics, "message">
): string {
  if (diagnostics.code === "no_enabled_quotes_source") {
    return "没有已启用的 quotes 行情信源；不会自动启用信源。";
  }
  if (diagnostics.code === "business_day_skipped") {
    return diagnostics.today.skipReason === "holiday"
      ? `今日为节假日${diagnostics.today.holidayName ? `（${diagnostics.today.holidayName}）` : ""}，行情抓取与简报生成已跳过。`
      : "今日为周末，行情抓取与简报生成已跳过。";
  }
  if (diagnostics.code === "generation_failed_with_data") {
    return diagnostics.failedBriefingQuotes
      ? `${diagnostics.failedBriefingQuotes.briefingDate} 已有 ${diagnostics.failedBriefingQuotes.nonNull} 条可用行情数据，但简报生成失败。`
      : "简报生成失败，且行情数据已入库。";
  }
  if (diagnostics.code === "no_latest_quote") {
    return diagnostics.latestQuote
      ? `请求区间内没有该指标行情；最近一条为 ${diagnostics.latestQuote.observedAt}。`
      : "已启用 quotes 行情源，但该指标尚无入库行情。";
  }
  return "行情数据可用。";
}

/**
 * GET /api/quotes/latest?metric_key=cu_main_close&days=7
 *
 * Returns the last N days of quotes for a given metric_key, ordered by
 * observed_at ASC (oldest first, for chart rendering).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const freshError = await requireFreshViewer(request);
  if (freshError) return freshError;

  const user = await getRequestUser(request);
  if (!user.role) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录" } },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const metricKey = searchParams.get("metric_key");
  const daysParam = searchParams.get("days");

  if (!metricKey) {
    return Response.json(
      { error: { code: "VALIDATION", message: "metric_key 参数必填" } },
      { status: 400 }
    );
  }

  const days = daysParam ? Math.min(Math.max(Number(daysParam), 1), 90) : 7;
  if (!Number.isFinite(days)) {
    return Response.json(
      { error: { code: "VALIDATION", message: "days 参数无效" } },
      { status: 400 }
    );
  }

  const now = dayjs().tz(APP_TIMEZONE);
  const todayStr = now.format("YYYY-MM-DD");
  const since = now.subtract(days, "day").toDate();

  const db = getDb();
  const [
    rows,
    latestQuoteRows,
    enabledQuoteSourceRows,
    holidayRows,
    todayQuoteStatsRows,
    latestBriefingRows
  ] = await Promise.all([
    db
      .select({
        observedAt: commodityQuotes.observedAt,
        value: commodityQuotes.value,
        changePct: commodityQuotes.changePct
      })
      .from(commodityQuotes)
      .where(
        and(
          eq(commodityQuotes.metricKey, metricKey),
          gte(commodityQuotes.observedAt, since)
        )
      )
      .orderBy(commodityQuotes.observedAt),
    db
      .select({
        observedAt: commodityQuotes.observedAt,
        value: commodityQuotes.value
      })
      .from(commodityQuotes)
      .where(eq(commodityQuotes.metricKey, metricKey))
      .orderBy(desc(commodityQuotes.observedAt))
      .limit(1),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(sources)
      .where(and(eq(sources.fetcherType, "quotes"), eq(sources.enabled, true))),
    db
      .select({ name: briefingHolidays.name })
      .from(briefingHolidays)
      .where(eq(briefingHolidays.holidayDate, todayStr))
      .limit(1),
    db
      .select({
        total: sql<number>`count(*)::int`,
        nonNull: sql<number>`count(*) filter (where ${commodityQuotes.value} is not null)::int`
      })
      .from(commodityQuotes)
      .where(
        sql`DATE(${commodityQuotes.observedAt} AT TIME ZONE 'Asia/Shanghai') = ${todayStr}::date`
      ),
    db
      .select({
        briefingDate: commodityBriefings.briefingDate,
        genStatus: commodityBriefings.genStatus,
        genError: commodityBriefings.genError,
        generatedAt: commodityBriefings.generatedAt
      })
      .from(commodityBriefings)
      .orderBy(
        desc(commodityBriefings.briefingDate),
        desc(commodityBriefings.id)
      )
      .limit(1)
  ]);

  const enabledQuotesSources = Number(enabledQuoteSourceRows[0]?.value ?? 0);
  const latestQuote = latestQuoteRows[0]
    ? {
        observedAt: latestQuoteRows[0].observedAt.toISOString(),
        value: numericOrNull(latestQuoteRows[0].value)
      }
    : null;
  const todayQuotes = {
    total: Number(todayQuoteStatsRows[0]?.total ?? 0),
    nonNull: Number(todayQuoteStatsRows[0]?.nonNull ?? 0)
  };
  const todayIsWeekend = now.day() === 0 || now.day() === 6;
  const holidayName = holidayRows[0]?.name ?? null;
  const skipReason = holidayName
    ? "holiday"
    : todayIsWeekend
      ? "weekend"
      : "none";
  const latestBriefing = latestBriefingRows[0]
    ? {
        briefingDate: latestBriefingRows[0].briefingDate,
        genStatus: latestBriefingRows[0].genStatus,
        genError: latestBriefingRows[0].genError,
        generatedAt:
          latestBriefingRows[0].generatedAt instanceof Date
            ? latestBriefingRows[0].generatedAt.toISOString()
            : null
      }
    : null;
  let failedBriefingQuotes: QuotesDiagnostics["failedBriefingQuotes"] = null;
  if (latestBriefing?.genStatus === "failed") {
    if (latestBriefing.briefingDate === todayStr) {
      failedBriefingQuotes = { briefingDate: todayStr, ...todayQuotes };
    } else {
      const [failedQuoteStats] = await db
        .select({
          total: sql<number>`count(*)::int`,
          nonNull: sql<number>`count(*) filter (where ${commodityQuotes.value} is not null)::int`
        })
        .from(commodityQuotes)
        .where(
          sql`DATE(${commodityQuotes.observedAt} AT TIME ZONE 'Asia/Shanghai') = ${latestBriefing.briefingDate}::date`
        );
      failedBriefingQuotes = {
        briefingDate: latestBriefing.briefingDate,
        total: Number(failedQuoteStats?.total ?? 0),
        nonNull: Number(failedQuoteStats?.nonNull ?? 0)
      };
    }
  }
  const generationFailedWithData =
    latestBriefing?.genStatus === "failed" &&
    (failedBriefingQuotes?.nonNull ?? 0) > 0;

  let code: QuotesDiagnosticCode = "ok";
  if (enabledQuotesSources === 0) {
    code = "no_enabled_quotes_source";
  } else if (skipReason !== "none" && rows.length === 0) {
    code = "business_day_skipped";
  } else if (generationFailedWithData) {
    code = "generation_failed_with_data";
  } else if (rows.length === 0) {
    code = "no_latest_quote";
  }

  const diagnosticsWithoutMessage: Omit<QuotesDiagnostics, "message"> = {
    code,
    enabledQuotesSources,
    today: {
      date: todayStr,
      isBusinessDay: skipReason === "none",
      skipReason,
      holidayName
    },
    latestQuote,
    todayQuotes,
    latestBriefing,
    failedBriefingQuotes,
    generationFailedWithData
  };
  const diagnostics: QuotesDiagnostics = {
    ...diagnosticsWithoutMessage,
    message: buildDiagnosticMessage(diagnosticsWithoutMessage)
  };

  return Response.json({ metricKey, days, items: rows, diagnostics });
}
