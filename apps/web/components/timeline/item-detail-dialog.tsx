"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FeedbackButtons } from "@/components/timeline/feedback-buttons";
import {
  entityTypeLabel,
  formatAppTime,
  SCORE_DIMENSIONS,
  scoreLabel,
} from "@/components/timeline/meta";

import type { ItemDetailDto } from "@/lib/api/timeline-query";

export function ItemDetailDialog({ itemId, onClose }: { itemId: number | null; onClose: () => void }): React.JSX.Element | null {
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

  useEffect(() => {
    if (!itemId) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [itemId, onClose]);

  if (!itemId) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/30 px-4 py-8"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-lg bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 p-5">
          <div>
            <p className="text-xs font-medium text-zinc-500">{item ? `${item.sourceName} · ${formatAppTime(item.scoredAt)}` : "条目详情"}</p>
            <h2 className="mt-2 text-xl font-semibold leading-7 text-zinc-950">{item?.title ?? (loading ? "加载中" : "不可访问")}</h2>
          </div>
          <Button
            aria-label="关闭详情"
            type="button"
            variant="outline"
            className="shrink-0 gap-2 border-zinc-300 bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow-sm hover:border-zinc-400 hover:bg-zinc-100"
            onClick={onClose}
          >
            <X className="h-5 w-5 shrink-0" aria-hidden />
            关闭
          </Button>
        </div>

        {item ? (
          <div className="flex flex-col gap-5 p-5">
            <div className="grid gap-2 sm:grid-cols-5">
              {SCORE_DIMENSIONS.map(({ key, label, abbr }) => (
                <div className="border border-zinc-200 p-3" key={key}>
                  <p className="text-[13px] font-medium text-zinc-700">{label}</p>
                  <p className="font-mono text-[10px] tracking-wide text-zinc-400">{abbr}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-950">{scoreLabel(item.scores[key])}</p>
                </div>
              ))}
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-zinc-900">摘要</h3>
              <p className="text-sm leading-6 text-zinc-700">{item.summaryZh ?? item.translationZh ?? item.content ?? "暂无摘要"}</p>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-zinc-900">实体</h3>
              <div className="flex flex-wrap gap-2">
                {item.entities.length > 0 ? (
                  item.entities.map((entity) => (
                    <span className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700" key={entity.id}>
                      {entityTypeLabel(entity.type)} · {entity.canonicalName}
                      {entity.circle ? ` · ${entity.circle}` : ""}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-zinc-500">暂无实体</span>
                )}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-zinc-900">聚簇</h3>
              <div className="space-y-2">
                {item.clusterItems.length > 0 ? (
                  item.clusterItems.map((clusterItem) => (
                    <a
                      className="block rounded-md border border-zinc-200 p-3 text-sm text-zinc-700 hover:bg-zinc-50"
                      href={clusterItem.url}
                      key={clusterItem.id}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <span className="font-medium text-zinc-950">{clusterItem.title}</span>
                      <span className="ml-2 text-xs text-zinc-500">{clusterItem.sourceName}</span>
                    </a>
                  ))
                ) : (
                  <span className="text-sm text-zinc-500">暂无关联条目</span>
                )}
              </div>
            </section>

            <FeedbackButtons itemId={item.id} />
          </div>
        ) : (
          <div className="p-5 text-sm text-zinc-600">{loading ? "加载中" : "该条目不存在或当前账号不可访问。"}</div>
        )}
      </div>
    </div>
  );
}
