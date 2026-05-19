"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ItemDetailDialog } from "@/components/timeline/item-detail-dialog";
import { TimelineCard } from "@/components/timeline/timeline-card";
import { useTimeline } from "@/hooks/use-timeline";

import type { TimelineResult } from "@/lib/api/timeline-query";
import type { TimelineItemDto } from "@/lib/api/timeline-query";

export function TimelineList({
  endpoint,
  initialData,
  variant = "list"
}: {
  endpoint: string;
  initialData: TimelineResult;
  variant?: "list" | "timeline";
}): React.JSX.Element {
  const queryClient = useMemo(() => new QueryClient(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <TimelineListInner endpoint={endpoint} initialData={initialData} variant={variant} />
    </QueryClientProvider>
  );
}

function TimelineListInner({ endpoint, initialData, variant }: { endpoint: string; initialData: TimelineResult; variant: "list" | "timeline" }): React.JSX.Element {
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const timeline = useTimeline(endpoint, initialData);
  const items = timeline.data?.pages.flatMap((page) => page.items) ?? [];
  const groups = groupByDay(items);

  return (
    <div className={variant === "timeline" ? "relative pl-8 before:absolute before:bottom-0 before:left-2 before:top-2 before:w-px before:bg-border-strong" : "flex flex-col gap-3"}>
      {items.length > 0 ? (
        variant === "timeline" ? groups.map((group) => (
          <section className="relative pb-1 pt-5" key={group.key}>
            <span className="absolute -left-8 top-9 h-4 w-4 border-[3px] border-bg bg-accent" aria-hidden="true" />
            <h3 className="mb-1 font-display text-[22px] leading-none tracking-[-0.6px] text-fg">{group.title}</h3>
            <div className="mb-3 font-mono text-[11px] tracking-[0.6px] text-fg-soft">
              {group.items.length} 条 · 按评分与时间倒序
            </div>
            <div className="space-y-3">
              {group.items.map((item) => <TimelineCard item={item} key={item.id} onOpen={setActiveItemId} />)}
            </div>
          </section>
        )) : items.map((item) => <TimelineCard item={item} key={item.id} onOpen={setActiveItemId} />)
      ) : (
        <div className="border border-border bg-surface p-8 text-center text-sm text-fg-soft">暂无条目</div>
      )}

      {timeline.hasNextPage ? (
        <Button
          className="self-center"
          type="button"
          variant="outline"
          disabled={timeline.isFetchingNextPage}
          onClick={() => void timeline.fetchNextPage()}
        >
          {timeline.isFetchingNextPage ? "加载中" : "加载更多"}
        </Button>
      ) : null}

      <ItemDetailDialog itemId={activeItemId} onClose={() => setActiveItemId(null)} />
    </div>
  );
}

function groupByDay(items: TimelineItemDto[]): Array<{ key: string; title: string; items: TimelineItemDto[] }> {
  const formatter = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" });
  const groups = new Map<string, { key: string; title: string; items: TimelineItemDto[] }>();

  for (const item of items) {
    const date = new Date(item.scoredAt ?? item.publishedAt);
    const key = date.toISOString().slice(0, 10);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, { key, title: formatter.format(date), items: [item] });
    }
  }

  return Array.from(groups.values());
}
