import { ExternalLink } from "lucide-react";
import { AlertStrip } from "@/components/shared/alert-strip";
import { formatAppTime, scoreLabel } from "@/components/timeline/meta";

import type { TimelineItemDto } from "@/lib/api/timeline-query";

export function TimelineCard({
  item,
  onOpen
}: {
  item: TimelineItemDto;
  onOpen?: (id: number) => void;
}): React.JSX.Element {
  const score = item.qualityScore ?? 0;
  const isHigh = score >= 8 || item.alertLevel === "L1";
  return (
    <article className={`relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-6 border bg-surface px-5 py-[18px] ${item.alertType ? "border-accent" : "border-border"}`}>
      <span
        className={`absolute -left-7 top-6 h-2 w-2 border-2 border-bg ${item.alertType || isHigh ? "bg-accent shadow-[0_0_0_4px_rgba(0,97,143,0.16)]" : "bg-fg"}`}
        aria-hidden="true"
      />
      <AlertStrip alertType={item.alertType} circle={item.topCircle} />
      <div className="min-w-0 pl-1">
        <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[11px] tracking-[0.6px] text-fg-soft">
          <span className="text-fg">{item.sourceName}</span>
          <span className="h-[3px] w-[3px] rounded-full bg-fg-soft" />
          <span>{item.sourceTier}</span>
          {item.topCircle ? <span className="border border-border bg-bg-deep px-2 py-0.5 text-fg-muted">{item.topCircle}</span> : null}
          {item.alertType ? <span className="border border-border bg-bg-deep px-2 py-0.5 text-fg-muted">{item.alertType}</span> : null}
          <span>{formatAppTime(item.scoredAt ?? item.publishedAt)}</span>
        </div>

        <a
          className="group mb-2 inline-flex items-start gap-2 text-[17px] leading-[1.4] tracking-[-0.1px] text-fg hover:text-accent"
          href={item.url}
          rel="noopener noreferrer"
          target="_blank"
        >
          <span>{item.title}</span>
          <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-fg-soft group-hover:text-accent" aria-hidden="true" />
        </a>

        {item.summaryZh ? <p className="line-clamp-3 text-[13px] leading-[1.6] text-fg-muted">{item.summaryZh}</p> : null}

        <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[11px] text-fg-muted">
          {item.category ? <span className="border border-border bg-bg-deep px-[7px] py-0.5">{item.category}</span> : null}
          {item.eventType ? <span className="border border-border bg-bg-deep px-[7px] py-0.5">{item.eventType}</span> : null}
          {item.relatedCount > 0 ? <span className="border border-border bg-bg-deep px-[7px] py-0.5">关联 {item.relatedCount}</span> : null}
        </div>
      </div>
      <div className="flex min-w-[140px] flex-col items-end gap-1.5">
        <div className={`font-mono text-2xl leading-none tracking-[-0.5px] tabular-nums ${isHigh ? "text-accent" : "text-fg"}`}>{scoreLabel(item.qualityScore)}</div>
        <div className="font-mono text-[10px] uppercase tracking-[1.2px] text-fg-soft">quality score</div>
        <div className="grid h-[18px] grid-cols-5 items-end gap-[3px]">
          {[0.35, 0.55, 0.75, 0.5, Math.max(0.45, Math.min(score / 10, 0.95))].map((height, index) => (
            <i key={index} className="block w-4 bg-sunshine-300 data-[hot=true]:bg-accent" data-hot={index >= 3} style={{ height: `${Math.round(height * 18)}px` }} />
          ))}
        </div>
        <button
          className="mt-2 border border-border-strong px-3 py-1.5 font-mono text-[11px] tracking-[0.8px] text-fg-muted hover:bg-bg-deep hover:text-fg"
          type="button"
          onClick={() => onOpen?.(item.id)}
        >
          展开详情
        </button>
      </div>
    </article>
  );
}
