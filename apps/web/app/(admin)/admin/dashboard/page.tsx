import { fetchDashboardData, type DashboardMetric } from "@/lib/api/dashboard-query";
import { listDisabledProxies } from "@/lib/api/proxy-admin";
import { ProxyPoolPanel } from "@/components/dashboard/proxy-pool-panel";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

export const dynamic = "force-dynamic";

function kpiTone(tone: string | undefined): string {
  if (tone === "critical") return "border-danger/40 bg-danger/5";
  if (tone === "warning") return "border-warn/40 bg-warn/5";
  return "border-border bg-surface";
}

function kpiDelta(tone: string | undefined): string {
  if (tone === "critical") return "text-danger";
  if (tone === "warning") return "text-warn";
  return "text-fg-muted";
}

function alertBadge(type: string): string {
  if (type === "own") return "bg-danger/10 text-danger";
  if (type === "safety") return "bg-warn/10 text-warn";
  return "bg-accent/10 text-accent";
}

export default async function AdminDashboardPage(): Promise<React.JSX.Element> {
  const [data, disabledProxies] = await Promise.all([
    fetchDashboardData(),
    Promise.resolve(listDisabledProxies())
  ]);

  const now = dayjs().tz(APP_TIMEZONE);
  const dateStr = now.format("YYYY.MM.DD");
  const timeStr = now.format("HH:mm");
  const scored = (data.metrics.find((m) => m.label === "已评分")?.value as number) ?? 0;
  const curated = (data.metrics.find((m) => m.label === "精选")?.value as number) ?? 0;

  const kpiCards: DashboardMetric[] = [
    { label: "今日抓取量", value: scored, tone: "default" },
    { label: "精选条目", value: curated, tone: "default" },
    { label: "自家公司告警", value: data.alertsToday.own, tone: data.alertsToday.own > 0 ? "critical" : "default" },
    {
      label: "信源健康度",
      value: data.sources.total > 0 ? `${Math.round(((data.sources.total - data.sources.disabled) / data.sources.total) * 100)}%` : "—",
      tone: data.sources.disabled > data.sources.total * 0.2 ? "warning" : "default"
    }
  ];

  const trendDimensions = [
    { label: "信源总数", value: data.sources.total, max: Math.max(data.sources.total, 1) },
    { label: "停用信源", value: data.sources.disabled, max: Math.max(data.sources.total, 1) },
    { label: "连续失败 ≥7", value: data.sources.failedSevenDays, max: Math.max(data.sources.total, 1) },
    { label: "待处理 backlog", value: data.backlog.pending, max: Math.max(data.backlog.pending + data.backlog.droppedExpired, 1) },
    { label: "超时丢弃", value: data.backlog.droppedExpired, max: Math.max(data.backlog.pending + data.backlog.droppedExpired, 1) },
    { label: "Priority 老化", value: data.backlog.oldPending, max: Math.max(data.backlog.pending, 1) }
  ];

  const topMetrics = data.metrics.filter(
    (m) => !["信源", "已评分", "精选"].includes(m.label)
  );

  const alertEntries: { type: string; count: number }[] = [
    { type: "own", count: data.alertsToday.own },
    { type: "safety", count: data.alertsToday.safety },
    { type: "policy", count: data.alertsToday.policy }
  ];

  const scrubberPending = data.scrubberPending;
  const mergeConflictsPending = data.mergeConflictsPending;
  const recentAuditCount = data.recentAuditCount;

  const sourceHealth = [
    { rank: 1, name: "活跃信源", count: data.sources.total - data.sources.disabled, max: data.sources.total },
    { rank: 2, name: "停用信源", count: data.sources.disabled, max: data.sources.total },
    { rank: 3, name: "连续失败 ≥7天", count: data.sources.failedSevenDays, max: data.sources.total }
  ];

  return (
    <main className="min-h-screen bg-bg px-6 py-8 font-body text-fg">
      <div className="mx-auto w-full max-w-7xl space-y-8">
        {/* ---- page-head ---- */}
        <header className="space-y-2">
          <p className="font-mono text-xs tracking-wide text-fg-soft uppercase">
            概览 · {dateStr} · {timeStr}
          </p>
          <h1 className="font-display text-3xl tracking-tightest text-fg">
            FE-Radar 运行仪表盘
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-fg-muted">
            已评分 <span className="font-display font-semibold text-fg">{scored}</span>{" "}
            条 · 精选{" "}
            <span className="font-display font-semibold text-fg">{curated}</span>{" "}
            条 · 待脱敏{" "}
            <span className="font-display font-semibold text-fg">{scrubberPending}</span>{" "}
            · 合并冲突{" "}
            <span className="font-display font-semibold text-fg">{mergeConflictsPending}</span>{" "}
            · 近 7 天审计{" "}
            <span className="font-display font-semibold text-fg">{recentAuditCount}</span>
          </p>
        </header>

        {/* ---- KPI grid ---- */}
        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {kpiCards.map((card) => (
            <div
              key={card.label}
              className={`rounded-none border p-5 shadow-card ${kpiTone(card.tone)}`}
            >
              <p className="font-mono text-[11px] uppercase tracking-widest text-fg-soft">
                {card.label}
              </p>
              <p className="mt-3 font-display text-4xl tracking-tightest text-fg">
                {card.value}
              </p>
              <p className={`mt-2 font-mono text-[11px] ${kpiDelta(card.tone)}`}>
                {card.tone === "critical" && "需关注"}
                {card.tone === "warning" && "偏高"}
                {card.tone === "default" && "正常"}
              </p>
            </div>
          ))}
        </section>

        {/* ---- trend + alerts row ---- */}
        <section className="grid gap-6 lg:grid-cols-2">
          {/* left: trend bars */}
          <div className="border border-border bg-surface p-6 shadow-card">
            <div className="flex items-baseline justify-between border-b border-hairline pb-3">
              <h3 className="font-display text-base font-semibold text-fg">近 7 天各维度</h3>
              <span className="font-mono text-[11px] text-fg-soft">
                更新 {timeStr}
              </span>
            </div>
            <div className="mt-5 space-y-4">
              {trendDimensions.map((dim) => {
                const pct = Math.round((dim.value / dim.max) * 100);
                return (
                  <div key={dim.label} className="space-y-1">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-xs text-fg-muted">{dim.label}</span>
                      <span className="font-mono text-xs tabular-nums text-fg">{dim.value}</span>
                    </div>
                    <div className="h-2 w-full bg-bg-deep">
                      <div
                        className="h-full bg-accent-flame transition-all"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* right: real-time alerts */}
          <div className="border border-border bg-surface p-6 shadow-card">
            <div className="flex items-baseline justify-between border-b border-hairline pb-3">
              <h3 className="font-display text-base font-semibold text-fg">今日告警</h3>
              <span className="font-mono text-[11px] text-fg-soft">
                共 {data.alertsToday.own + data.alertsToday.safety + data.alertsToday.policy} 条
              </span>
            </div>
            <div className="mt-4 space-y-0 divide-y divide-hairline">
              {alertEntries.map((entry) => (
                <div
                  key={entry.type}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-3"
                >
                  <span
                    className={`inline-block rounded-none px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${alertBadge(entry.type)}`}
                  >
                    {entry.type}
                  </span>
                  <span className="text-sm text-fg">
                    {entry.type === "own" && "自家公司相关"}
                    {entry.type === "safety" && "安全合规"}
                    {entry.type === "policy" && "政策变动"}
                  </span>
                  <span className="font-mono text-sm tabular-nums text-fg">
                    {entry.count}
                  </span>
                </div>
              ))}
            </div>

            {/* quick extras */}
            <div className="mt-5 border-t border-hairline pt-4 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-xs text-fg-muted">人工脱敏待处理</span>
                <span className={`font-mono text-sm tabular-nums ${scrubberPending > 0 ? "text-warn" : "text-fg"}`}>
                  {scrubberPending}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-xs text-fg-muted">合并冲突待处理</span>
                <span className={`font-mono text-sm tabular-nums ${mergeConflictsPending > 0 ? "text-warn" : "text-fg"}`}>
                  {mergeConflictsPending}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-xs text-fg-muted">Priority 老化率</span>
                <span className={`font-mono text-sm tabular-nums ${
                  data.backlog.tone === "critical" ? "text-danger" : data.backlog.tone === "warning" ? "text-warn" : "text-fg"
                }`}>
                  {Math.round(data.backlog.oldPendingRatio * 100)}%
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ---- TOP picks + source ranking ---- */}
        <section className="grid gap-6 lg:grid-cols-2">
          {/* left: TOP picks */}
          <div className="border border-border bg-surface p-6 shadow-card">
            <div className="flex items-baseline justify-between border-b border-hairline pb-3">
              <h3 className="font-display text-base font-semibold text-fg">关键指标 TOP</h3>
              <span className="font-mono text-[11px] text-fg-soft">
                近 7 天审计 {recentAuditCount}
              </span>
            </div>
            <div className="mt-4 space-y-0 divide-y divide-hairline">
              {topMetrics.map((metric, i) => (
                <div
                  key={metric.label}
                  className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 py-3"
                >
                  <span className="font-mono text-sm tabular-nums text-fg-soft">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm text-fg">{metric.label}</span>
                  <span className={`font-mono text-sm tabular-nums ${
                    metric.tone === "critical" ? "text-danger" : metric.tone === "warning" ? "text-warn" : "text-fg"
                  }`}>
                    {metric.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* right: source ranking */}
          <div className="border border-border bg-surface p-6 shadow-card">
            <div className="flex items-baseline justify-between border-b border-hairline pb-3">
              <h3 className="font-display text-base font-semibold text-fg">信源健康排名</h3>
              <span className="font-mono text-[11px] text-fg-soft">
                共 {data.sources.total} 源
              </span>
            </div>
            <div className="mt-4 space-y-4">
              {sourceHealth.map((src) => {
                const pct = Math.round((src.count / src.max) * 100);
                return (
                  <div key={src.name} className="space-y-1">
                    <div className="flex items-baseline justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs tabular-nums text-accent">
                          #{src.rank}
                        </span>
                        <span className="text-sm text-fg">{src.name}</span>
                      </div>
                      <span className="font-mono text-xs tabular-nums text-fg">
                        {src.count}
                      </span>
                    </div>
                    <div className="h-2 w-full bg-bg-deep">
                      <div
                        className={`h-full transition-all ${
                          src.name === "停用信源" || src.name === "连续失败 ≥7天"
                            ? "bg-warn"
                            : "bg-ok"
                        }`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 border-t border-hairline pt-4">
              <h4 className="font-mono text-[11px] uppercase tracking-widest text-fg-soft">
                代理池
              </h4>
              <div className="mt-3">
                <ProxyPoolPanel initialItems={disabledProxies} />
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
