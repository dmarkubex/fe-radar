import { notFound } from "next/navigation";
import { AnalyzeButton } from "@/components/copilot/analyze-button";
import { fetchItemDetail } from "@/lib/api/timeline-query";
import {
  formatAppTime,
  scoreLabel,
  SCORE_DIMENSIONS,
  entityTypeLabel
} from "@/components/timeline/meta";
import {
  alertStripClass,
  alertTypeLabel
} from "@/components/shared/alert-strip";
import { FeedbackButtons } from "@/components/timeline/feedback-buttons";
import {
  ExternalLink,
  ChevronRight,
  Clock,
  Building2,
  BarChart3
} from "lucide-react";
import { safeExternalUrl } from "@/lib/safe-external-url";

export const dynamic = "force-dynamic";

const DIMENSIONS = SCORE_DIMENSIONS;

function dimBarColor(value: number | null): string {
  if (value === null) return "bg-border";
  if (value >= 70) return "bg-ok";
  if (value >= 40) return "bg-warn";
  return "bg-danger";
}

function scoreColor(value: number | null): string {
  if (value === null) return "text-fg-soft";
  if (value >= 70) return "text-ok";
  if (value >= 40) return "text-warn";
  return "text-danger";
}

export default async function ItemDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const query = await searchParams;
  const from = Array.isArray(query.from) ? query.from[0] : query.from;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    notFound();
  }

  const item = await fetchItemDetail(itemId);
  if (!item) {
    notFound();
  }
  const displayUrl = safeExternalUrl(item.displayUrl);

  return (
    <div className="@container w-full">
      <div className="mx-auto w-full max-w-[1400px] px-[clamp(1rem,4cqi,2.5rem)] py-[clamp(1.5rem,2.5cqi,2rem)]">
        {/* ── Breadcrumb ── */}
        <nav className="mb-6 flex min-h-11 items-center gap-2 font-mono text-[11px] text-fg-soft">
          {from === "alerts" ? (
            <a href="/alerts" className="inline-flex min-h-11 items-center transition-colors hover:text-accent">
              ← 返回告警
            </a>
          ) : (
            <a href="/" className="inline-flex min-h-11 items-center transition-colors hover:text-accent">
              时间线
            </a>
          )}
          <ChevronRight className="h-3 w-3" />
          {item.category && (
            <>
              <span className="text-fg-muted">{item.category}</span>
              <ChevronRight className="h-3 w-3" />
            </>
          )}
          <span className="text-fg">#{item.id}</span>
        </nav>

        {/* ── 2-Column Grid (fluid: collapses below container width) ── */}
        <div className="grid grid-cols-1 gap-[clamp(1.5rem,3cqi,2.5rem)] @4xl:grid-cols-[minmax(0,1fr)_clamp(16rem,22cqi,19rem)]">
          {/* ── Article Column ── */}
          <article>
            {/* Tag Row */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {item.alertType && (
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    item.alertType === "own"
                      ? "bg-danger"
                      : item.alertType === "safety"
                        ? "bg-fg-muted"
                        : "bg-accent"
                  }`}
                />
              )}
              {item.sourceTier && (
                <span className="text-[10px] font-mono tracking-[0.4px] px-2 py-[2px] border border-border rounded-[1px] text-fg-soft">
                  {item.sourceTier}
                </span>
              )}
              {item.topCircle && (
                <span className="text-[10px] font-mono tracking-[0.4px] px-2 py-[2px] border border-border rounded-[1px] text-fg-soft">
                  {item.topCircle}
                </span>
              )}
              {item.category && (
                <span className="text-[10px] font-mono tracking-[0.4px] px-2 py-[2px] border border-border rounded-[1px] text-fg-soft">
                  {item.category}
                </span>
              )}
              {item.alertLevel && (
                <span className="text-[10px] font-mono tracking-[0.4px] px-2 py-[2px] bg-bg-deep rounded-[1px] text-fg-muted">
                  {item.alertLevel}
                </span>
              )}
              {item.eventType && (
                <span className="text-[10px] font-mono tracking-[0.4px] px-2 py-[2px] border border-border rounded-[1px] text-fg-soft">
                  {item.eventType}
                </span>
              )}
            </div>

            {/* Title */}
            <h1 className="font-display text-[clamp(1.5rem,3.2cqi,1.75rem)] leading-[1.28] tracking-[-0.4px] text-fg mb-3">
              {item.title}
            </h1>

            {/* Deck Summary */}
            {item.summaryZh && (
              <p className="text-[clamp(0.875rem,1.4cqi,0.9375rem)] leading-[26px] text-fg-muted mb-4 max-w-[62ch]">
                {item.summaryZh}
              </p>
            )}

            {/* Byline */}
            <div className="flex items-center gap-3 mb-8 pb-6 border-b border-hairline">
              <div className="flex items-center justify-center w-8 h-8 rounded-[2px] bg-surface-deep text-white text-[11px] font-mono">
                {item.sourceName.slice(0, 2)}
              </div>
              <div>
                <div className="text-[13px] text-fg font-medium">
                  {item.sourceName}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-fg-soft">
                  <Clock className="h-3 w-3" />
                  <span className="font-mono">
                    {formatAppTime(item.scoredAt ?? item.publishedAt)}
                  </span>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-3">
                <AnalyzeButton copilotEligible={item.copilotEligible} itemId={item.id} />
                {displayUrl ? (
                  <a
                    href={displayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-flame transition-colors"
                  >
                    原文链接
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="border border-accent/30 bg-accent/8 px-2 py-1 font-mono text-[10px] tracking-[0.8px] text-accent">
                    {item.acquisitionLabel ?? "AI获取"}
                  </span>
                )}
              </div>
            </div>

            {/* Body Content */}
            {item.translationZh && (
              <section className="mb-8">
                <h2 className="font-display text-[18px] leading-[24px] text-fg mb-3">
                  中文翻译
                </h2>
                <div className="text-[14px] leading-[26px] text-fg-muted whitespace-pre-wrap">
                  {item.translationZh}
                </div>
              </section>
            )}

            {item.content && (
              <section className="mb-8">
                <h2 className="font-display text-[18px] leading-[24px] text-fg mb-3">
                  原文内容
                </h2>
                <div className="whitespace-pre-wrap text-[14px] leading-[26px] text-fg-muted">
                  {item.content}
                </div>
              </section>
            )}

            {/* AI Note Block */}
            {item.summaryZh && (
              <div className="rounded-[2px] border border-accent/20 bg-surface-warm p-5 mb-8">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="h-4 w-4 text-accent" />
                  <span className="font-mono text-[10px] tracking-[1.2px] uppercase text-accent">
                    AI 分析摘要
                  </span>
                </div>
                <p className="text-[13px] leading-[22px] text-fg-muted">
                  {item.summaryZh}
                </p>
              </div>
            )}

            {/* Feedback */}
            <div className="mb-8">
              <div className="font-mono text-[10px] tracking-[1.2px] uppercase text-fg-soft mb-3">
                反馈
              </div>
              <FeedbackButtons itemId={item.id} />
            </div>
          </article>

          {/* ── Meta Sidebar ── */}
          <aside className="flex flex-col gap-[clamp(1rem,2cqi,1.25rem)] @4xl:sticky @4xl:top-16 self-start">
            {/* Composite Score */}
            <div className="rounded-[2px] border border-border bg-surface p-5 text-center shadow-card">
              <div className="font-mono text-[13px] tracking-widest uppercase text-fg-soft mb-2">
                综合评分
              </div>
              <div
                className={`font-mono text-[clamp(2.25rem,6cqi,3rem)] leading-[1.08] tracking-[-2px] ${scoreColor(item.qualityScore)}`}
              >
                {scoreLabel(item.qualityScore)}
              </div>
              <div className="font-mono text-[10px] text-fg-soft mt-1">
                0-100
              </div>
            </div>

            {/* 5 Dimension Bars */}
            <div className="rounded-[2px] border border-border bg-surface p-5 shadow-card">
              <div className="font-mono text-[13px] tracking-widest uppercase text-fg-soft mb-3">
                五维评分
              </div>
              <div className="flex flex-col gap-2">
                {DIMENSIONS.map((dim) => {
                  const value = item.scores[
                    dim.key as keyof typeof item.scores
                  ] as number | null;
                  const pct =
                    value !== null
                      ? Math.min(100, Math.max(0, Math.round(value)))
                      : 0;
                  return (
                    <div key={dim.key}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[13px] text-fg-muted">
                          <span className="font-mono text-[13px] text-fg-soft mr-1">
                            {dim.abbr}
                          </span>
                          {dim.label}
                        </span>
                        <span
                          className={`font-mono text-sm tabular-nums ${scoreColor(value)}`}
                        >
                          {scoreLabel(value)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-bg-deep overflow-hidden">
                        <div
                          className={`h-full transition-all ${dimBarColor(value)}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Entities */}
            {item.entities.length > 0 && (
              <div className="rounded-[2px] border border-border bg-surface p-5 shadow-card">
                <div className="font-mono text-[12px] tracking-[1.2px] uppercase text-fg-soft mb-3">
                  识别实体
                </div>
                <div className="flex flex-col gap-2">
                  {item.entities.map((entity) => (
                    <div
                      key={entity.id}
                      className="flex min-w-0 items-center justify-between gap-3"
                    >
                      <span className="min-w-0 truncate text-[12px] text-fg" title={entity.canonicalName}>
                        {entity.canonicalName}
                      </span>
                      <span className="shrink-0 text-[10px] font-mono text-fg-soft">
                        {entityTypeLabel(entity.type)}
                        {entity.circle ? ` · ${entity.circle}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Source Card */}
            <div className="rounded-[2px] border border-border bg-surface p-5 shadow-card">
              <div className="font-mono text-[10px] tracking-[1.2px] uppercase text-fg-soft mb-3">
                信源
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-[2px] bg-surface-deep text-white text-[13px] font-mono">
                  {item.sourceName.slice(0, 2)}
                </div>
                <div>
                  <div className="text-[13px] text-fg font-medium">
                    {item.sourceName}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-fg-soft font-mono">
                    <Building2 className="h-3 w-3" />
                    <span>{item.sourceTier}</span>
                    {item.sourceCategory && (
                      <>
                        <span>·</span>
                        <span>{item.sourceCategory}</span>
                      </>
                    )}
                    {item.acquisitionLabel && (
                      <>
                        <span>·</span>
                        <span>{item.acquisitionLabel}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Alert Status */}
            {item.alertType && (
              <div className="rounded-[2px] border border-border bg-surface p-5 shadow-card">
                <div className="font-mono text-[12px] tracking-[1.2px] uppercase text-fg-soft mb-3">
                  告警通道
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className={`h-2.5 w-2.5 rounded-full ${alertStripClass(item.alertType, item.topCircle)}`}
                  />
                  <span className="text-[12px] text-fg">
                    {alertTypeLabel(item.alertType)}
                  </span>
                  {item.alertLevel && (
                    <span className="text-[10px] font-mono text-fg-soft ml-auto">
                      {item.alertLevel}
                    </span>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>

        {/* ── Related Items Grid ── */}
        {item.clusterItems.length > 0 && (
          <section className="mt-12 border-t border-hairline pt-8">
            <div className="flex items-center gap-3 mb-6">
              <span className="font-mono text-[10px] tracking-[1.2px] uppercase text-fg-soft">
                关联条目
              </span>
              <div className="flex-1 border-t border-hairline" />
              <span className="text-[11px] text-fg-soft font-mono">
                {item.clusterItems.length} 条
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-3 @5xl:grid-cols-4">
              {item.clusterItems.map((related) => (
                <a
                  key={related.id}
                  href={`/items/${related.id}`}
                  className="group rounded-[2px] border border-border bg-surface p-4 hover:bg-bg-deep hover:border-border-strong transition-colors"
                >
                  <div className="text-[11px] text-fg-soft font-mono mb-1.5 flex items-center justify-between">
                    <span>{related.sourceName}</span>
                    {related.similarity !== null && (
                      <span className="text-[10px]">
                        {Math.round(related.similarity * 100)}%
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] leading-[18px] text-fg font-medium group-hover:text-accent transition-colors line-clamp-3">
                    {related.title}
                  </div>
                  <div className="text-[10px] text-fg-soft font-mono mt-2">
                    {formatAppTime(related.publishedAt)}
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
