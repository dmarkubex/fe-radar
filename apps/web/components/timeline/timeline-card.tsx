import { ExternalLink } from "lucide-react";
import { AlertStrip, alertTypeLabel } from "@/components/shared/alert-strip";
import { formatAppTime, scoreLabel, SOURCE_TIER_LABELS } from "@/components/timeline/meta";

import type { TimelineItemDto } from "@/lib/api/timeline-query";

/** Decorative mini-bar heights (list view has no per-dimension scores). */
function scoreBarHeights(qualityScore: number): number[] {
  return [
    0.35,
    0.55,
    0.75,
    0.5,
    Math.max(0.45, Math.min(qualityScore / 100, 0.95))
  ];
}

/** Single accent ramp — opacity steps only, no secondary blue tokens. */
const SCORE_BAR_OPACITY = [0.22, 0.38, 0.54, 0.7, 0.86] as const;

export function TimelineCard({
  item,
  onOpen
}: {
  item: TimelineItemDto;
  onOpen?: (id: number) => void;
}): React.JSX.Element {
  const score = item.qualityScore ?? 0;
  const isHigh = score >= 70 || item.alertLevel === "L1";
  const barHeights = scoreBarHeights(score);

  return (
    <article
      className={`relative grid grid-cols-1 items-start gap-4 border bg-surface px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6 sm:px-5 sm:py-[18px] ${
        item.alertType ? "border-accent/50" : "border-hairline"
      }`}
    >
      <span
        className={`absolute -left-7 top-6 h-2 w-2 border-2 border-bg ${
          item.alertType || isHigh ? "bg-accent" : "bg-fg-soft"
        }`}
        aria-hidden="true"
      />
      <AlertStrip alertType={item.alertType} circle={item.topCircle} />
      <div className="min-w-0 pl-1">
        <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[11px] tracking-[0.6px] text-fg-soft">
          <span className="text-fg">{item.sourceName}</span>
          <span className="h-[3px] w-[3px] rounded-full bg-fg-soft" />
          <span title={SOURCE_TIER_LABELS[item.sourceTier as keyof typeof SOURCE_TIER_LABELS] ?? item.sourceTier}>
            {item.sourceTier}
          </span>
          {item.topCircle ? (
            <span className="border border-hairline bg-bg-deep px-2 py-0.5 text-fg-muted">
              {item.topCircle}
            </span>
          ) : null}
          {item.alertType ? (
            <span className="border border-accent/30 bg-accent/8 px-2 py-0.5 text-accent">
              {alertTypeLabel(item.alertType)}
            </span>
          ) : null}
          <span>{formatAppTime(item.publishedAt)}</span>
        </div>

        {item.displayUrl ? (
          <a
            className="group mb-2 inline-flex items-start gap-2 text-[17px] leading-[1.4] tracking-normal text-fg hover:text-accent"
            href={item.displayUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span>{item.title}</span>
            <ExternalLink
              className="mt-0.5 h-4 w-4 shrink-0 text-fg-soft group-hover:text-accent"
              aria-hidden="true"
            />
          </a>
        ) : (
          <div className="mb-2 flex flex-wrap items-start gap-2 text-[17px] leading-[1.4] tracking-normal text-fg">
            <span>{item.title}</span>
            <span className="mt-0.5 border border-accent/30 bg-accent/8 px-2 py-0.5 font-mono text-[10px] leading-4 tracking-[0.8px] text-accent">
              {item.acquisitionLabel ?? "AI获取"}
            </span>
          </div>
        )}

        {item.summaryZh ? (
          <p className="line-clamp-3 text-[13px] leading-[1.6] text-fg-muted">
            {item.summaryZh}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[11px] text-fg-muted">
          {item.category ? (
            <span className="border border-hairline bg-bg-deep px-[7px] py-0.5">
              {item.category}
            </span>
          ) : null}
          {item.eventType ? (
            <span className="border border-hairline bg-bg-deep px-[7px] py-0.5">
              {item.eventType}
            </span>
          ) : null}
          {item.relatedCount > 0 ? (
            <span className="border border-hairline bg-bg-deep px-[7px] py-0.5">
              关联 {item.relatedCount}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 border-t border-hairline pt-3 sm:min-w-[140px] sm:flex-col sm:items-end sm:justify-start sm:border-t-0 sm:pt-0">
        <div className="flex flex-col items-start gap-1.5 sm:items-end">
          <div
            className={`font-mono text-3xl leading-none tracking-normal tabular-nums ${
              isHigh ? "text-accent" : "text-fg"
            }`}
          >
            {scoreLabel(item.qualityScore)}
          </div>
          <div className="font-mono text-[13px] uppercase tracking-[1.2px] text-fg-soft">
            综合评分
          </div>
          <div
            className="grid h-[18px] grid-cols-5 items-end gap-[3px]"
            aria-hidden="true"
          >
            {barHeights.map((height, index) => (
              <i
                key={index}
                className="block w-4 bg-accent"
                style={{
                  height: `${Math.round(height * 18)}px`,
                  opacity: SCORE_BAR_OPACITY[index]
                }}
              />
            ))}
          </div>
        </div>
        <button
          className="border border-border-strong px-3 py-1.5 font-mono text-[11px] tracking-[0.8px] text-fg-muted hover:border-accent/40 hover:bg-accent/5 hover:text-accent sm:mt-2"
          type="button"
          aria-label={`展开详情：${item.title}`}
          onClick={() => onOpen?.(item.id)}
        >
          展开详情
        </button>
      </div>
    </article>
  );
}
