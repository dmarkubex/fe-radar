import { and, asc, desc, eq, gt, gte, inArray, lt, lte } from "drizzle-orm";
import { notFound } from "next/navigation";
import {
  commodityBriefings,
  commodityQuotes,
  getDb,
} from "@fe-radar/db";
import { dayjs, APP_TIMEZONE } from "@fe-radar/shared";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { BriefingLineChart } from "@/components/briefing/briefing-line-chart";
import { DownloadButton } from "@/components/briefing/download-button";
import {
  BRIEFING_QUOTE_METRIC_KEYS,
  CU_CHANGE_METRIC,
  CU_MAIN_METRIC,
  CU_SPOT_METRIC,
  LC_CHANGE_METRIC,
  LC_MAIN_METRIC,
  LC_SPOT_METRIC,
  formatChangePctDisplay,
  formatPriceDisplay,
  indexQuoteValues,
  pickMetalDayQuotes,
  type MetalDayQuotes,
} from "@/lib/briefing-quote-display";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types derived from payload_json structure (BRIEFING_SCHEMA + computed S/R)
// ---------------------------------------------------------------------------

interface OutlookPayload {
  trend?: string;
  support?: number | null;
  resistance?: number | null;
}

interface MetalPayload {
  logic_summary?: string;
  outlook?: OutlookPayload;
}

interface BriefingPayload {
  cu?: MetalPayload;
  lc?: MetalPayload;
  macro_summary?: string;
  risk_notes?: string[];
  procurement_advice?: string;
}

const TREND_COLOR: Record<string, string> = {
  "偏多": "text-market-up",
  "区间震荡": "text-warn",
  "偏弱": "text-market-down",
};

const RETENTION_DAYS = 90;

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function dateParam(value: string | string[] | undefined, fallback: string): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate) && dayjs(candidate).format("YYYY-MM-DD") === candidate
    ? candidate
    : fallback;
}

function isDocxExpired(dateStr: string): boolean {
  return dayjs(dateStr).tz(APP_TIMEZONE).isBefore(
    dayjs().tz(APP_TIMEZONE).subtract(RETENTION_DAYS, "day").startOf("day")
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function BriefingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: PageSearchParams;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) notFound();

  const db = getDb();

  const [briefing] = await db
    .select()
    .from(commodityBriefings)
    .where(eq(commodityBriefings.id, numId))
    .limit(1);

  if (!briefing) notFound();

  // gen_status=failed → 404 with friendly message
  if (briefing.genStatus === "failed") notFound();

  // Anchor all quote windows to this briefing's calendar day (Asia/Shanghai),
  // not "today" — otherwise every historical detail page ends on the latest close.
  //
  // commodity_briefings.briefing_date is a Postgres `date` column; Drizzle maps it
  // to string (typically "YYYY-MM-DD"), not Date. Keep the string branch first —
  // do not "fix" by treating the column as Date-only.
  const briefingDateStr =
    typeof briefing.briefingDate === "string"
      ? briefing.briefingDate.slice(0, 10)
      : dayjs(briefing.briefingDate).tz(APP_TIMEZONE).format("YYYY-MM-DD");
  const navigationEnd = dateParam((await searchParams).end, briefingDateStr);
  const dayStart = dayjs.tz(briefingDateStr, APP_TIMEZONE).startOf("day");
  const dayEnd = dayStart.add(1, "day");
  const chartSince = dayStart.subtract(6, "day");

  const [dayQuoteRows, cuQuotes, lcQuotes, dateRows, newerDateRows] = await Promise.all([
    db
      .select({
        metricKey: commodityQuotes.metricKey,
        value: commodityQuotes.value,
      })
      .from(commodityQuotes)
      .where(
        and(
          inArray(commodityQuotes.metricKey, [...BRIEFING_QUOTE_METRIC_KEYS]),
          gte(commodityQuotes.observedAt, dayStart.toDate()),
          lt(commodityQuotes.observedAt, dayEnd.toDate())
        )
      ),
    db
      .select({ observedAt: commodityQuotes.observedAt, value: commodityQuotes.value })
      .from(commodityQuotes)
      .where(
        and(
          eq(commodityQuotes.metricKey, CU_MAIN_METRIC),
          gte(commodityQuotes.observedAt, chartSince.toDate()),
          lt(commodityQuotes.observedAt, dayEnd.toDate())
        )
      )
      .orderBy(commodityQuotes.observedAt),
    db
      .select({ observedAt: commodityQuotes.observedAt, value: commodityQuotes.value })
      .from(commodityQuotes)
      .where(
        and(
          eq(commodityQuotes.metricKey, LC_MAIN_METRIC),
          gte(commodityQuotes.observedAt, chartSince.toDate()),
          lt(commodityQuotes.observedAt, dayEnd.toDate())
        )
      )
      .orderBy(commodityQuotes.observedAt),
    db
      .select({
        id: commodityBriefings.id,
        briefingDate: commodityBriefings.briefingDate,
      })
      .from(commodityBriefings)
      .where(
        and(
          inArray(commodityBriefings.genStatus, ["succeeded", "degraded"]),
          lte(commodityBriefings.briefingDate, navigationEnd)
        )
      )
      .orderBy(desc(commodityBriefings.briefingDate))
      .limit(8),
    db
      .select({
        id: commodityBriefings.id,
        briefingDate: commodityBriefings.briefingDate,
      })
      .from(commodityBriefings)
      .where(
        and(
          inArray(commodityBriefings.genStatus, ["succeeded", "degraded"]),
          gt(commodityBriefings.briefingDate, navigationEnd)
        )
      )
      .orderBy(asc(commodityBriefings.briefingDate))
      .limit(7),
  ]);

  const dayByKey = indexQuoteValues(dayQuoteRows);
  const cuDayQuotes = pickMetalDayQuotes(dayByKey, CU_MAIN_METRIC, CU_SPOT_METRIC, CU_CHANGE_METRIC);
  const lcDayQuotes = pickMetalDayQuotes(dayByKey, LC_MAIN_METRIC, LC_SPOT_METRIC, LC_CHANGE_METRIC);

  const payload = (briefing.payloadJson ?? {}) as BriefingPayload;
  const dateDisplay = dayjs(briefing.briefingDate).tz(APP_TIMEZONE).format("YYYY 年 M 月 D 日 dddd");
  const expired = isDocxExpired(briefing.briefingDate);
  const visibleDates = dateRows.slice(0, 7);
  const earlier = dateRows[7];
  const newer = newerDateRows[newerDateRows.length - 1];

  const cuSrNull =
    payload.cu?.outlook?.support == null || payload.cu?.outlook?.resistance == null;
  const lcSrNull =
    payload.lc?.outlook?.support == null || payload.lc?.outlook?.resistance == null;

  // Serialize dates for client components
  const cuChartData = cuQuotes.map((r) => ({
    observedAt: r.observedAt instanceof Date ? r.observedAt.toISOString() : String(r.observedAt),
    value: r.value != null ? String(r.value) : null,
  }));
  const lcChartData = lcQuotes.map((r) => ({
    observedAt: r.observedAt instanceof Date ? r.observedAt.toISOString() : String(r.observedAt),
    value: r.value != null ? String(r.value) : null,
  }));

  return (
    <div className="bg-bg">
      <div className="sticky top-[var(--shell-header-h)] z-10 flex flex-wrap items-center justify-between gap-4 border-b border-border bg-bg pad-fluid-x py-3.5">
        <div className="shrink-0 font-mono text-[11px] tracking-[1px] text-fg-muted">每日简报</div>
        <nav aria-label="每日简报日期" className="flex flex-wrap justify-end gap-1.5">
          {earlier ? (
            <Link
              href={`/briefing/${earlier.id}?end=${earlier.briefingDate}`}
              aria-label="后退一组日期"
              className="inline-flex min-h-10 items-center border border-border bg-surface px-3 py-1.5 font-mono text-[11px] text-fg-muted hover:bg-bg-deep active:scale-95 sm:min-h-8"
            >
              后退
            </Link>
          ) : (
            <span aria-disabled="true" className="inline-flex min-h-10 cursor-not-allowed items-center border border-border bg-surface px-3 py-1.5 font-mono text-[11px] text-fg-muted opacity-40 sm:min-h-8">
              后退
            </span>
          )}
          {visibleDates.map((row) => (
            <Link
              key={row.id}
              href={`/briefing/${row.id}?end=${navigationEnd}`}
              aria-current={row.id === briefing.id ? "date" : undefined}
              className={`inline-flex min-h-10 items-center border px-3 py-1.5 font-mono text-[11px] active:scale-95 sm:min-h-8 ${
                row.id === briefing.id
                  ? "border-fg bg-fg text-white"
                  : "border-border bg-surface text-fg-muted hover:bg-bg-deep"
              }`}
            >
              {dayjs(row.briefingDate).tz(APP_TIMEZONE).format("M/D")}
            </Link>
          ))}
          {newer ? (
            <Link
              href={`/briefing/${newer.id}?end=${newer.briefingDate}`}
              aria-label="前进一组日期"
              className="inline-flex min-h-10 items-center border border-border bg-surface px-3 py-1.5 font-mono text-[11px] text-fg-muted hover:bg-bg-deep active:scale-95 sm:min-h-8"
            >
              前进
            </Link>
          ) : (
            <span aria-disabled="true" className="inline-flex min-h-10 cursor-not-allowed items-center border border-border bg-surface px-3 py-1.5 font-mono text-[11px] text-fg-muted opacity-40 sm:min-h-8">
              前进
            </span>
          )}
        </nav>
      </div>

      <div className="mx-auto w-full max-w-[1100px] px-6 py-8 md:px-10">

      {/* Title row */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[2px] text-fg-soft mb-1">
            简报 · {briefing.briefingDate}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-fg">
            远东·铜锂行情简报
          </h1>
          <p className="text-sm text-fg-muted mt-1">
            {dateDisplay}
            {briefing.genStatus === "degraded" && (
              <span className="ml-2 font-mono text-[10px] text-warn uppercase">降级生成</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DownloadButton
            briefingId={briefing.id}
            briefingDate={briefing.briefingDate}
            expired={expired}
          />
        </div>
      </div>

      {/* 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* CU card */}
        <MetalCard
          label="铜"
          abbr="CU"
          payload={payload.cu}
          dayQuotes={cuDayQuotes}
          chartData={cuChartData}
          chartUnit="元/吨"
          srNull={cuSrNull}
        />

        {/* LC card */}
        <MetalCard
          label="碳酸锂"
          abbr="LC"
          payload={payload.lc}
          dayQuotes={lcDayQuotes}
          chartData={lcChartData}
          chartUnit="元/吨"
          srNull={lcSrNull}
        />
      </div>

      {/* Macro summary */}
      {payload.macro_summary && (
        <section className="mb-6 rounded-[2px] border border-border bg-surface p-5">
          <div className="font-mono text-[10px] uppercase tracking-[1.2px] text-fg-soft mb-3">
            宏观摘要
          </div>
          <p className="text-[14px] leading-[26px] text-fg-muted">{payload.macro_summary}</p>
        </section>
      )}

      {/* Risk notes */}
      {Array.isArray(payload.risk_notes) && payload.risk_notes.length > 0 && (
        <section className="mb-6 rounded-[2px] border border-border bg-surface p-5">
          <div className="font-mono text-[10px] uppercase tracking-[1.2px] text-fg-soft mb-3">
            风险提示
          </div>
          <ul className="flex flex-col gap-2">
            {payload.risk_notes.map((note, i) => (
              <li key={i} className="flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-warn flex-shrink-0 mt-0.5" />
                <span className="text-[13px] leading-[22px] text-fg-muted">{note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Procurement advice */}
      {payload.procurement_advice && (
        <section className="mb-6 rounded-[2px] border border-accent/20 bg-surface-warm p-5">
          <div className="font-mono text-[10px] uppercase tracking-[1.2px] text-accent mb-2">
            采购建议
          </div>
          <p className="text-[14px] font-medium text-fg">{payload.procurement_advice}</p>
        </section>
      )}

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetalCard — RSC sub-component (no client state needed, chart is client)
// ---------------------------------------------------------------------------

interface MetalCardProps {
  label: string;
  abbr: string;
  payload: MetalPayload | undefined;
  dayQuotes: MetalDayQuotes;
  chartData: { observedAt: string; value: string | null }[];
  chartUnit: string;
  srNull: boolean;
}

function MetalCard({
  label,
  abbr,
  payload,
  dayQuotes,
  chartData,
  chartUnit,
  srNull,
}: MetalCardProps): React.JSX.Element {
  const trend = payload?.outlook?.trend;
  const support = payload?.outlook?.support;
  const resistance = payload?.outlook?.resistance;
  const changeLabel = formatChangePctDisplay(dayQuotes.changePct);

  return (
    <div className="rounded-[2px] border border-border bg-surface p-5 flex flex-col gap-4">
      {/* Card header */}
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[1.2px] text-fg-soft">
          {abbr} · {label}
        </div>
        {trend && (
          <span className={`font-mono text-[11px] font-medium ${TREND_COLOR[trend] ?? "text-fg"}`}>
            {trend}
          </span>
        )}
      </div>

      {/* Same-day main + spot from commodity_quotes (not LLM text) */}
      <div className="grid grid-cols-1 gap-2 shell:grid-cols-2">
        <div className="rounded-[2px] border border-border bg-bg-deep px-3 py-2.5">
          <div className="font-mono text-[9px] uppercase tracking-[0.8px] text-fg-soft mb-1">
            主力收盘
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-[18px] font-semibold tabular-nums text-fg">
              {formatPriceDisplay(dayQuotes.mainClose)}
            </span>
            {dayQuotes.mainClose != null && (
              <span className="font-mono text-[10px] text-fg-soft">{chartUnit}</span>
            )}
            {changeLabel && (
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  dayQuotes.changePct != null && dayQuotes.changePct >= 0
                    ? "text-market-up"
                    : "text-market-down"
                }`}
              >
                {changeLabel}
              </span>
            )}
          </div>
        </div>
        <div className="rounded-[2px] border border-border bg-bg-deep px-3 py-2.5">
          <div className="font-mono text-[9px] uppercase tracking-[0.8px] text-fg-soft mb-1">
            SMM 现货
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-[18px] font-semibold tabular-nums text-fg">
              {formatPriceDisplay(dayQuotes.spot)}
            </span>
            {dayQuotes.spot != null && (
              <span className="font-mono text-[10px] text-fg-soft">{chartUnit}</span>
            )}
          </div>
        </div>
      </div>

      {/* Chart: main contract only, window ends on briefing date */}
      <BriefingLineChart data={chartData} label="近 7 日 · 主力" unit={chartUnit} />

      {/* Logic summary */}
      {payload?.logic_summary && (
        <p className="text-[13px] leading-[22px] text-fg-muted">{payload.logic_summary}</p>
      )}

      {/* S/R cards */}
      <div className="grid grid-cols-1 gap-3 shell:grid-cols-2">
        <div className="rounded-[2px] border border-border bg-bg-deep p-3 text-center">
          <div className="font-mono text-[9px] uppercase tracking-[0.8px] text-fg-soft mb-1">支撑位</div>
          <div className="font-mono text-[16px] text-fg font-semibold">
            {support != null ? support.toLocaleString("zh-CN") : "—"}
          </div>
        </div>
        <div className="rounded-[2px] border border-border bg-bg-deep p-3 text-center">
          <div className="font-mono text-[9px] uppercase tracking-[0.8px] text-fg-soft mb-1">压力位</div>
          <div className="font-mono text-[16px] text-fg font-semibold">
            {resistance != null ? resistance.toLocaleString("zh-CN") : "—"}
          </div>
        </div>
      </div>

      {/* v0.4 fix E3: S/R null degradation notice */}
      {srNull && (
        <div className="flex items-start gap-1.5 text-[11px] text-fg-soft font-mono">
          <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5 text-warn" />
          <span>
            近 20 个交易日样本不足 10 条，支撑/压力位未计算（design §6.5）。样本达标后新生成的简报会显示数值。
          </span>
        </div>
      )}
    </div>
  );
}
