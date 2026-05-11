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
  return (
    <article className="relative overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <AlertStrip alertType={item.alertType} circle={item.topCircle} />
      <div className="flex flex-col gap-3 p-4 pl-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span className="font-medium text-zinc-800">{item.sourceName}</span>
          <span>{item.sourceTier}</span>
          {item.topCircle ? <span className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-700">{item.topCircle}</span> : null}
          {item.alertType ? <span className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-700">{item.alertType}</span> : null}
          <span>{formatAppTime(item.scoredAt ?? item.publishedAt)}</span>
        </div>

        <a
          className="group inline-flex items-start gap-2 text-base font-semibold leading-6 text-zinc-950 hover:text-blue-700"
          href={item.url}
          rel="noopener noreferrer"
          target="_blank"
        >
          <span>{item.title}</span>
          <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400 group-hover:text-blue-700" aria-hidden="true" />
        </a>

        {item.summaryZh ? <p className="line-clamp-3 text-sm leading-6 text-zinc-600">{item.summaryZh}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2 text-xs text-zinc-600">
            {item.category ? <span className="rounded border border-zinc-200 px-2 py-1">{item.category}</span> : null}
            {item.eventType ? <span className="rounded border border-zinc-200 px-2 py-1">{item.eventType}</span> : null}
            {item.relatedCount > 0 ? <span className="rounded border border-zinc-200 px-2 py-1">关联 {item.relatedCount}</span> : null}
          </div>
          <button
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            type="button"
            onClick={() => onOpen?.(item.id)}
          >
            详情 · {scoreLabel(item.qualityScore)}
          </button>
        </div>
      </div>
    </article>
  );
}
