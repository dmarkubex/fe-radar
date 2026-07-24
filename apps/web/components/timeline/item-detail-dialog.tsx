"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FeedbackButtons } from "@/components/timeline/feedback-buttons";
import { MirofishPredictionButton } from "@/components/timeline/mirofish-prediction-button";
import {
  entityTypeLabel,
  formatAppTime,
  SCORE_DIMENSIONS,
  scoreLabel,
} from "@/components/timeline/meta";
import { safeItemHref } from "@/lib/safe-external-url";

import type { ItemDetailDto } from "@/lib/api/timeline-query";

export function ItemDetailDialog({
  canCreatePrediction,
  itemId,
  onClose
}: {
  canCreatePrediction: boolean;
  itemId: number | null;
  onClose: () => void;
}): React.JSX.Element | null {
  const [item, setItem] = useState<ItemDetailDto | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!itemId) {
      setItem(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/items/${itemId}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("detail failed"))))
      .then((data: { item: ItemDetailDto }) => {
        if (!cancelled) {
          setItem(data.item);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setItem(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (!itemId) {
    return null;
  }

  return (
    <Dialog
      ariaLabel="条目详情"
      onClose={onClose}
      open
      overlayClassName="items-end justify-center p-0 shell:items-start shell:px-4 shell:py-8"
      panelClassName="max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-lg bg-surface shadow-pop shell:max-h-none shell:max-w-3xl shell:rounded-lg"
    >
      <div className="flex items-start justify-between gap-4 border-b border-hairline p-5">
        <div>
          <p className="text-xs font-medium text-fg-soft">{item ? `${item.sourceName} · ${formatAppTime(item.scoredAt)}` : "条目详情"}</p>
          <h2 className="mt-2 text-xl font-semibold leading-7 text-fg">{item?.title ?? (loading ? "加载中" : "不可访问")}</h2>
        </div>
        <Button
          aria-label="关闭详情"
          type="button"
          variant="outline"
          className="min-h-11 shrink-0 gap-2 px-4 py-2.5 text-sm font-semibold"
          onClick={onClose}
        >
          <X className="h-5 w-5 shrink-0" aria-hidden />
          关闭
        </Button>
      </div>

      {item ? (
        <div className="flex flex-col gap-5 p-5">
          <div className="grid grid-cols-2 gap-2 shell:grid-cols-5">
            {SCORE_DIMENSIONS.map(({ key, label, abbr }) => (
              <div className="border border-hairline p-3" key={key}>
                <p className="text-[13px] font-medium text-fg-muted">{label}</p>
                <p className="font-mono text-[10px] tracking-wide text-fg-soft">{abbr}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-fg">{scoreLabel(item.scores[key])}</p>
              </div>
            ))}
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">摘要</h3>
            <p className="text-sm leading-6 text-fg-muted">{item.summaryZh ?? item.translationZh ?? item.content ?? "暂无摘要"}</p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">实体</h3>
            <div className="flex flex-wrap gap-2">
              {item.entities.length > 0 ? (
                item.entities.map((entity) => (
                  <span className="rounded-md bg-bg-deep px-2.5 py-1 text-xs text-fg-muted" key={entity.id}>
                    {entityTypeLabel(entity.type)} · {entity.canonicalName}
                    {entity.circle ? ` · ${entity.circle}` : ""}
                  </span>
                ))
              ) : (
                <span className="text-sm text-fg-soft">暂无实体</span>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">聚簇</h3>
            <div className="space-y-2">
              {item.clusterItems.length > 0 ? (
                item.clusterItems.map((clusterItem) => {
                  const href = safeItemHref(clusterItem.url);
                  const content = (
                    <>
                      <span className="font-medium text-fg">{clusterItem.title}</span>
                      <span className="ml-2 text-xs text-fg-soft">{clusterItem.sourceName}</span>
                    </>
                  );
                  return href?.startsWith("/items/") ? (
                    <Link
                      className="block rounded-md border border-hairline p-3 text-sm text-fg-muted hover:bg-bg"
                      href={href}
                      key={clusterItem.id}
                    >
                      {content}
                    </Link>
                  ) : href ? (
                    <a
                      className="block rounded-md border border-hairline p-3 text-sm text-fg-muted hover:bg-bg"
                      href={href}
                      key={clusterItem.id}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {content}
                    </a>
                  ) : (
                    <div className="block rounded-md border border-hairline p-3 text-sm text-fg-muted" key={clusterItem.id}>
                      {content}
                    </div>
                  );
                })
              ) : (
                <span className="text-sm text-fg-soft">暂无关联条目</span>
              )}
            </div>
          </section>

          <FeedbackButtons itemId={item.id} />
          {canCreatePrediction ? <MirofishPredictionButton itemId={item.id} /> : null}
        </div>
      ) : loading ? (
        <div className="space-y-4 p-5" aria-label="正在加载条目详情">
          <div className="h-20 animate-pulse bg-bg-deep" />
          <div className="h-4 w-2/3 animate-pulse bg-bg-deep" />
          <div className="h-4 w-full animate-pulse bg-bg-deep" />
        </div>
      ) : (
        <div className="p-5 text-sm text-fg-muted">该条目不存在或当前账号不可访问。</div>
      )}
    </Dialog>
  );
}
