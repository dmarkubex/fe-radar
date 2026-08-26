"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ItemDetailDialog } from "@/components/timeline/item-detail-dialog";
import { TimelineCard } from "@/components/timeline/timeline-card";
import { useTimeline } from "@/hooks/use-timeline";
import { groupTimeline } from "@/components/timeline/timeline-grouping";
import { buildTimelineEndpoint } from "@/lib/api/timeline-endpoint";
import { useShallowSearchParams } from "@/hooks/use-shallow-search-params";

import type { TimelineResult } from "@/lib/api/timeline-query";

export function TimelineList({
  endpoint,
  initialData,
  variant = "list"
}: {
  endpoint: string;
  initialData: TimelineResult;
  variant?: "list" | "timeline";
}): React.JSX.Element {
  return (
    <TimelineListInner
      endpoint={endpoint}
      initialData={initialData}
      variant={variant}
    />
  );
}

function TimelineListInner({
  endpoint,
  initialData,
  variant
}: {
  endpoint: string;
  initialData: TimelineResult;
  variant: "list" | "timeline";
}): React.JSX.Element {
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const pathname = usePathname();
  const searchParams = useShallowSearchParams();
  const liveEndpoint = buildTimelineEndpoint(pathname ?? "/", searchParams);
  const timeline = useTimeline(liveEndpoint, initialData, endpoint);
  // 在全量 flatMap 后的 items 上分组，跨页同日合并
  const items = useMemo(
    () => timeline.data?.pages.flatMap((page) => page.items) ?? [],
    [timeline.data]
  );
  const dayGroups = useMemo(() => groupTimeline(items), [items]);

  // 触底自动加载（移动端阅读流）；保留"加载更多"按钮作兜底
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && timeline.hasNextPage && !timeline.isFetchingNextPage) {
          void timeline.fetchNextPage();
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [timeline.hasNextPage, timeline.isFetchingNextPage, timeline.fetchNextPage]);

  return (
    <div
      className={
        variant === "timeline"
          ? "relative pl-8 before:absolute before:bottom-0 before:left-2 before:top-2 before:w-px before:bg-border-strong max-[760px]:pl-0 max-[760px]:before:hidden"
          : "flex flex-col gap-3"
      }
    >
      {items.length > 0 ? (
        variant === "timeline" ? (
          dayGroups.map((dayGroup) => (
            <section className="relative" key={dayGroup.dayKey}>
              {/* 粗节点：日期，sticky 吸顶，z-[5] 低于 app-shell header (z-10/z-30) */}
              <div
                className="sticky top-[var(--shell-header-h)] z-[5] -ml-8 mb-2 flex items-center gap-3 bg-bg py-1 pr-2 max-[760px]:ml-0"
                role="heading"
                aria-level={2}
              >
                <span
                  className="ml-2 h-4 w-4 shrink-0 border-[3px] border-bg bg-accent max-[760px]:hidden"
                  aria-hidden="true"
                />
                <h2 className="font-display text-[22px] leading-none tracking-[-0.6px] text-fg">
                  {dayGroup.dayLabel}
                </h2>
              </div>

              {/* 细节点：时段带，非空段倒序（晚间→下午→上午→凌晨） */}
              <div className="space-y-4 pb-4">
                {dayGroup.periods.map((periodGroup) => (
                  <div className="relative" key={periodGroup.period}>
                    {/* 细节点圆点 */}
                    <div className="relative mb-2 flex items-center gap-3">
                      <span
                        className="absolute -left-[1.625rem] h-2 w-2 border-2 border-bg bg-fg-soft max-[760px]:hidden"
                        aria-hidden="true"
                      />
                      <p className="font-mono text-[11px] tracking-[0.6px] text-fg-soft">
                        {periodGroup.label} · {periodGroup.items.length} 条
                      </p>
                    </div>
                    <div className="space-y-3">
                      {periodGroup.items.map((item) => (
                        <TimelineCard item={item} key={item.id} onOpen={setActiveItemId} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))
        ) : (
          // variant="list": 扁平卡片流，不分组，不依赖 groupTimeline
          items.map((item) => <TimelineCard item={item} key={item.id} onOpen={setActiveItemId} />)
        )
      ) : (
        <div className="border border-border bg-surface p-8 text-center text-sm text-fg-soft">
          <p>
            {(pathname ?? "").startsWith("/search") && !searchParams.get("q")?.trim()
              ? "输入关键词后开始检索"
              : "暂无条目"}
          </p>
          {searchParams.size > 0 ? (
            <Link className="mt-3 inline-flex min-h-10 items-center text-accent hover:underline" href={pathname}>
              清除筛选
            </Link>
          ) : null}
        </div>
      )}

      {timeline.hasNextPage ? (
        <>
          <div ref={sentinelRef} aria-hidden="true" className="h-1 w-full" />
          <Button
            className="self-center"
            type="button"
            variant="outline"
            disabled={timeline.isFetchingNextPage}
            onClick={() => void timeline.fetchNextPage()}
          >
            {timeline.isFetchingNextPage ? "加载中" : "加载更多"}
          </Button>
        </>
      ) : null}

      <ItemDetailDialog
        itemId={activeItemId}
        onClose={() => setActiveItemId(null)}
      />
    </div>
  );
}
