"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ItemDetailDialog } from "@/components/timeline/item-detail-dialog";
import { TimelineCard } from "@/components/timeline/timeline-card";
import { useTimeline } from "@/hooks/use-timeline";

import type { TimelineResult } from "@/lib/api/timeline-query";

export function TimelineList({
  endpoint,
  initialData
}: {
  endpoint: string;
  initialData: TimelineResult;
}): React.JSX.Element {
  const queryClient = useMemo(() => new QueryClient(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <TimelineListInner endpoint={endpoint} initialData={initialData} />
    </QueryClientProvider>
  );
}

function TimelineListInner({ endpoint, initialData }: { endpoint: string; initialData: TimelineResult }): React.JSX.Element {
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const timeline = useTimeline(endpoint, initialData);
  const items = timeline.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      {items.length > 0 ? (
        items.map((item) => <TimelineCard item={item} key={item.id} onOpen={setActiveItemId} />)
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">暂无条目</div>
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
