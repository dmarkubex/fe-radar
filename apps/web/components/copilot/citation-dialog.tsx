"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { formatAppTime } from "@/components/timeline/meta";
import { useCopilot } from "./copilot-context";

/** GET cite 直办接口响应 DTO（无聚簇成员） */
interface CiteDto {
  id: number;
  title: string;
  summaryZh: string | null;
  sourceName: string;
  scoredAt: string | null;
}

/**
 * 引用弹层（z-[70]，至多一层，换 id 不叠层）。
 * 只调 cite 直办接口 —— 禁止复用 ItemDetailDialog cluster、
 * 禁止调条目详情接口。点击引用卡不得改会话状态。
 * 本层为 citationMode：不渲染「帮我分析」。
 */
export function CitationDialog(): React.JSX.Element | null {
  const { citationItemId, setCitationItemId } = useCopilot();
  const [citation, setCitation] = useState<CiteDto | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (citationItemId === null) {
      setCitation(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/copilot/cite/${citationItemId}`)
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("cite failed"))
      )
      .then((data: CiteDto) => {
        if (!cancelled) setCitation(data);
      })
      .catch(() => {
        if (!cancelled) setCitation(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [citationItemId]);

  return (
    <Dialog
      ariaLabel="引用条目"
      enabled={citationItemId !== null}
      onClose={() => setCitationItemId(null)}
      open={citationItemId !== null}
      overlayClassName="z-[70]"
      panelClassName="max-h-[80dvh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface shadow-pop"
    >
      <div className="flex items-start justify-between gap-4 border-b border-hairline p-5">
        <div>
          <p className="text-xs font-medium text-fg-soft">
            {citation
              ? `${citation.sourceName} · ${formatAppTime(citation.scoredAt)}`
              : "引用条目"}
          </p>
          <h2 className="mt-2 text-lg font-semibold leading-7 text-fg">
            {citation?.title ?? (loading ? "加载中" : "条目不可见")}
          </h2>
        </div>
        <button
          aria-label="关闭引用"
          className="shrink-0 rounded-[2px] border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-deep"
          onClick={() => setCitationItemId(null)}
          type="button"
        >
          关闭
        </button>
      </div>
      <div className="p-5">
        {citation ? (
          <p className="whitespace-pre-wrap text-sm leading-6 text-fg-muted">
            {citation.summaryZh ?? "暂无摘要"}
          </p>
        ) : loading ? (
          <div className="space-y-3" aria-label="正在加载引用">
            <div className="h-4 w-2/3 animate-pulse bg-bg-deep" />
            <div className="h-4 w-full animate-pulse bg-bg-deep" />
          </div>
        ) : (
          <p className="text-sm text-fg-muted">该条目不存在或当前账号不可见。</p>
        )}
      </div>
    </Dialog>
  );
}
