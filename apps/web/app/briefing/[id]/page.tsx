import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { and, gte } from "drizzle-orm";
import {
  briefingPushes,
  briefingTargets,
  commodityBriefings,
  commodityQuotes,
  getDb,
} from "@fe-radar/db";
import { dayjs, APP_TIMEZONE } from "@fe-radar/shared";
import { auth } from "@/auth";
import { ChevronRight, AlertTriangle, CheckCircle, XCircle, Clock } from "lucide-react";
import Link from "next/link";
import { BriefingLineChart } from "@/components/briefing/briefing-line-chart";
import { DownloadButton } from "@/components/briefing/download-button";
import { RegenerateButton } from "@/components/briefing/regenerate-button";

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
  "偏多": "text-danger",
  "区间震荡": "text-warn",
  "偏弱": "text-ok",
};

const PUSH_STATUS_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  succeeded: { label: "成功", icon: CheckCircle },
  failed:    { label: "失败", icon: XCircle },
  pending:   { label: "待推送", icon: Clock },
};

const RETENTION_DAYS = 90;

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
}: {
  params: Promise<{ id: string }>;
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

  // Fetch push records
  const pushRows = await db
    .select({
      id: briefingPushes.id,
      targetId: briefingPushes.targetId,
      targetName: briefingTargets.name,
      pushStatus: briefingPushes.pushStatus,
      attemptCount: briefingPushes.attemptCount,
      errorDetail: briefingPushes.errorDetail,
      pushedAt: briefingPushes.pushedAt,
    })
    .from(briefingPushes)
    .leftJoin(briefingTargets, eq(briefingPushes.targetId, briefingTargets.id))
    .where(eq(briefingPushes.briefingId, numId));

  // Fetch 7-day quotes for CU and LC
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const [cuQuotes, lcQuotes] = await Promise.all([
    db
      .select({ observedAt: commodityQuotes.observedAt, value: commodityQuotes.value })
      .from(commodityQuotes)
      .where(and(eq(commodityQuotes.metricKey, "cu_main_close"), gte(commodityQuotes.observedAt, since)))
      .orderBy(commodityQuotes.observedAt),
    db
      .select({ observedAt: commodityQuotes.observedAt, value: commodityQuotes.value })
      .from(commodityQuotes)
      .where(and(eq(commodityQuotes.metricKey, "lc_main_close"), gte(commodityQuotes.observedAt, since)))
      .orderBy(commodityQuotes.observedAt),
  ]);

  const session = await auth();
  const isAdmin = session?.user?.role === "admin";

  const payload = (briefing.payloadJson ?? {}) as BriefingPayload;
  const dateDisplay = dayjs(briefing.briefingDate).tz(APP_TIMEZONE).format("YYYY 年 M 月 D 日 dddd");
  const generatedAt = briefing.generatedAt instanceof Date
    ? dayjs(briefing.generatedAt).tz(APP_TIMEZONE).format("YYYY-MM-DD HH:mm")
    : String(briefing.generatedAt);
  const expired = isDocxExpired(briefing.briefingDate);

  const cuSrNull =
    payload.cu?.outlook?.support == null || payload.cu?.outlook?.resistance == null;
  const lcSrNull =
    payload.lc?.outlook?.support == null || payload.lc?.outlook?.resistance == null;

  // Serialize dates for client components
  const cuChartData = cuQuotes.map((r) => ({
    observedAt: r.observedAt instanceof Date ? r.observedAt.toISOString() : String(r.observedAt),
    value: r.value,
  }));
  const lcChartData = lcQuotes.map((r) => ({
    observedAt: r.observedAt instanceof Date ? r.observedAt.toISOString() : String(r.observedAt),
    value: r.value,
  }));

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8 md:px-10">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-[11px] font-mono text-fg-soft mb-6">
        <Link href="/briefing" className="hover:text-accent transition-colors">
          每日简报
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-fg">{briefing.briefingDate}</span>
      </nav>

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
            {dateDisplay} · 生成于 {generatedAt}
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
          <RegenerateButton
            briefingId={briefing.id}
            genStatus={briefing.genStatus}
            isAdmin={isAdmin}
          />
        </div>
      </div>

      {/* 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* CU card */}
        <MetalCard
          label="沪铜主力"
          abbr="CU"
          payload={payload.cu}
          chartData={cuChartData}
          chartUnit="元/吨"
          srNull={cuSrNull}
        />

        {/* LC card */}
        <MetalCard
          label="碳酸锂主力"
          abbr="LC"
          payload={payload.lc}
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

      {/* Push status */}
      {pushRows.length > 0 && (
        <section className="mb-6 rounded-[2px] border border-border bg-surface p-5">
          <div className="font-mono text-[10px] uppercase tracking-[1.2px] text-fg-soft mb-3">
            推送状态
          </div>
          <div className="flex flex-col divide-y divide-hairline">
            {pushRows.map((p) => {
              const meta = PUSH_STATUS_META[p.pushStatus] ?? PUSH_STATUS_META.pending!;
              const Icon = meta.icon;
              return (
                <div key={p.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2">
                    <Icon
                      className={`h-3.5 w-3.5 flex-shrink-0 ${
                        p.pushStatus === "succeeded"
                          ? "text-ok"
                          : p.pushStatus === "failed"
                            ? "text-danger"
                            : "text-fg-soft"
                      }`}
                    />
                    <span className="text-[13px] text-fg">{p.targetName ?? "(已删除)"}</span>
                    {p.attemptCount > 1 && (
                      <span className="font-mono text-[10px] text-fg-soft">×{p.attemptCount}</span>
                    )}
                  </div>
                  <div className="text-right">
                    <span className={`font-mono text-[11px] ${
                      p.pushStatus === "succeeded" ? "text-ok" : p.pushStatus === "failed" ? "text-danger" : "text-fg-soft"
                    }`}>
                      {meta.label}
                    </span>
                    {p.pushedAt && (
                      <div className="font-mono text-[10px] text-fg-soft">
                        {dayjs(p.pushedAt instanceof Date ? p.pushedAt : new Date(p.pushedAt))
                          .tz(APP_TIMEZONE)
                          .format("HH:mm")}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
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
  chartData: { observedAt: string; value: string | null }[];
  chartUnit: string;
  srNull: boolean;
}

function MetalCard({ label, abbr, payload, chartData, chartUnit, srNull }: MetalCardProps): React.JSX.Element {
  const trend = payload?.outlook?.trend;
  const support = payload?.outlook?.support;
  const resistance = payload?.outlook?.resistance;

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

      {/* 7-day chart */}
      <BriefingLineChart data={chartData} label="7 日折线" unit={chartUnit} />

      {/* Logic summary */}
      {payload?.logic_summary && (
        <p className="text-[13px] leading-[22px] text-fg-muted">{payload.logic_summary}</p>
      )}

      {/* S/R cards */}
      <div className="grid grid-cols-2 gap-3">
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
            近期数据样本不足，支撑/压力位计算已降级（design §6.5）
          </span>
        </div>
      )}
    </div>
  );
}
