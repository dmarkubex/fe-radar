"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { formatAppTime } from "@/components/timeline/meta";

import type { TimelineItemDto } from "@/lib/api/timeline-query";

type AlertRange = "24h" | "7d" | "all";

const LEVEL_META: Record<
  string,
  { title: string; small: string; pri: string; card: string }
> = {
  L1: {
    title: "P1 · 立即响应",
    small: "CONDITION · ESCALATED",
    pri: "P1 紧急",
    card: "border-danger border-l-4"
  },
  L2: {
    title: "P2 · 关注",
    small: "CONDITIONS · 待审阅",
    pri: "P2 关注",
    card: "border-border"
  },
  L3: {
    title: "P3 · 留底",
    small: "CONDITIONS · 信息备忘",
    pri: "P3 留底",
    card: "border-border"
  }
};

export function AlertList({
  items,
  filterRange
}: {
  items: TimelineItemDto[];
  filterRange: AlertRange;
}): React.JSX.Element {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dismissing, setDismissing] = useState(false);
  const [localDismissed, setLocalDismissed] = useState<Set<number>>(new Set());

  const visibleItems = items.filter((item) => !localDismissed.has(item.id));
  const grouped = groupByLevel(visibleItems);

  function toggleSelected(id: number): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function dismissItems(itemIds: number[]): Promise<void> {
    if (itemIds.length === 0 || dismissing) return;
    setDismissing(true);
    try {
      const response = await fetch("/api/alerts/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds })
      });
      if (!response.ok) return;
      setLocalDismissed((prev) => new Set([...prev, ...itemIds]));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of itemIds) next.delete(id);
        return next;
      });
      router.refresh();
    } finally {
      setDismissing(false);
    }
  }

  return (
    <div data-range={filterRange}>
      {visibleItems.length > 0 ? (
        <div className="mb-4 flex justify-end">
          <button
            className="border border-border bg-surface px-3 py-2 text-xs text-fg-muted hover:bg-bg-deep disabled:cursor-not-allowed disabled:opacity-50"
            disabled={selected.size === 0 || dismissing}
            onClick={() => void dismissItems([...selected])}
            type="button"
          >
            批量忽略({selected.size})
          </button>
        </div>
      ) : null}

      {Object.entries(grouped).map(([level, group]) => {
        const meta = LEVEL_META[level] ?? LEVEL_META.L3!;
        return (
          <section key={level}>
            <div className="my-5 flex items-center gap-3.5">
              <h2 className="m-0 font-display text-lg font-normal tracking-[-0.3px] text-fg">
                {meta.title}
              </h2>
              <div className="h-px flex-1 bg-border" />
              <small className="font-mono text-[10px] uppercase tracking-[1px] text-fg-soft">
                {group.length} {meta.small}
              </small>
            </div>
            {group.map((item) => (
              <BigAlert
                checked={selected.has(item.id)}
                disabled={dismissing}
                item={item}
                key={item.id}
                level={level}
                onDismiss={(id) => void dismissItems([id])}
                onToggle={toggleSelected}
              />
            ))}
          </section>
        );
      })}

      {visibleItems.length === 0 ? (
        <div className="py-20 text-center text-sm text-fg-soft">
          当前筛选条件下无告警
        </div>
      ) : null}
    </div>
  );
}

function BigAlert({
  checked,
  disabled,
  item,
  level,
  onDismiss,
  onToggle
}: {
  checked: boolean;
  disabled: boolean;
  item: TimelineItemDto;
  level: string;
  onDismiss: (id: number) => void;
  onToggle: (id: number) => void;
}): React.JSX.Element {
  const meta = LEVEL_META[level] ?? LEVEL_META.L3!;
  const priClass =
    level === "L1" ? "bg-danger" : level === "L2" ? "bg-warn" : "bg-fg";
  const score =
    item.qualityScore !== null ? Math.round(item.qualityScore) : null;
  const reason = alertReason(item);

  return (
    <article
      className={`relative mb-2.5 grid grid-cols-[1fr_220px] items-start gap-7 border bg-surface px-5 py-[18px] max-[1100px]:grid-cols-1 ${meta.card}`}
    >
      <input
        aria-label={`选择告警 ${item.title}`}
        checked={checked}
        className="absolute left-2 top-2 h-4 w-4 accent-accent"
        disabled={disabled}
        onChange={() => onToggle(item.id)}
        type="checkbox"
      />
      <div className="min-w-0 pl-4">
        <div className="mb-2.5 flex flex-wrap items-center gap-2 font-mono text-[11px] tracking-[0.6px] text-fg-soft">
          <span
            className={`${priClass} px-2 py-1 text-[10px] uppercase tracking-[1.4px] text-white`}
          >
            {meta.pri}
          </span>
          <span className="font-mono text-xs text-fg">
            {formatAppTime(item.scoredAt ?? item.publishedAt)}
          </span>
          <span className="text-border-strong">·</span>
          <span className="border border-border bg-bg-deep px-2 py-0.5">
            {item.sourceTier}
          </span>
          {item.topCircle ? (
            <span className="border border-border bg-bg-deep px-2 py-0.5">
              {item.topCircle}
            </span>
          ) : null}
          {item.alertType ? (
            <span className="border border-border bg-bg-deep px-2 py-0.5">
              {alertLabel(item.alertType)}
            </span>
          ) : null}
          <span>{item.sourceName}</span>
        </div>
        <h3 className="mb-2 font-display text-xl font-normal leading-[1.3] tracking-[-0.4px] text-fg">
          {item.displayUrl ? (
            <a
              href={item.displayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-start gap-2 hover:text-accent"
            >
              {item.title}
              <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-fg-soft" />
            </a>
          ) : (
            <span className="inline-flex flex-wrap items-start gap-2">
              {item.title}
              <span className="mt-1 border border-accent/30 bg-accent/8 px-2 py-0.5 font-mono text-[10px] leading-4 tracking-[0.8px] text-accent">
                {item.acquisitionLabel ?? "AI获取"}
              </span>
            </span>
          )}
        </h3>
        {item.summaryZh ? (
          <p className="m-0 max-w-[72ch] text-[13px] leading-[1.65] text-fg-muted">
            {item.summaryZh}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.topCircle === "C1" ? (
            <span className="border border-surface-deep bg-surface-deep px-2 py-1 text-[11px] text-white">
              C1 自家
            </span>
          ) : null}
          {item.eventType ? (
            <span className="border border-border bg-bg-deep px-2 py-1 text-[11px] text-fg-muted">
              {item.eventType}
            </span>
          ) : null}
          {item.category ? (
            <span className="border border-border bg-bg-deep px-2 py-1 text-[11px] text-fg-muted">
              {item.category}
            </span>
          ) : null}
          {item.relatedCount > 0 ? (
            <span className="border border-border bg-bg-deep px-2 py-1 text-[11px] text-fg-muted">
              关联 {item.relatedCount}
            </span>
          ) : null}
        </div>
      </div>

      <aside className="flex min-h-full flex-col gap-3 border-l border-hairline pl-6 max-[1100px]:border-l-0 max-[1100px]:border-t max-[1100px]:pl-0 max-[1100px]:pt-4">
        <div className="flex items-baseline justify-between border-b border-hairline pb-2.5">
          <small className="font-mono text-[12px] uppercase tracking-[1.2px] text-fg-soft">
            质量分
          </small>
          <b className="font-display text-[32px] font-normal leading-none tracking-[-0.8px] text-accent">
            {score ?? "-"}
          </b>
        </div>
        <div className="border-b border-hairline pb-2.5 text-[12px] leading-[1.7] text-fg-muted">
          <b className="mb-1 block font-mono text-[12px] font-normal uppercase tracking-[1.2px] text-fg">
            告警原因
          </b>
          {reason}
        </div>
        <div className="font-mono text-[12px] leading-[1.75] tracking-[0.2px] text-fg-muted">
          <b className="mb-1 block text-[12px] font-normal uppercase tracking-[1.2px] text-fg">
            已推送
          </b>
          · {channelText(item.alertType)}
          <br />
          <span className="text-ok">
            ✓ 钉钉机器人 {formatAppTime(item.scoredAt ?? item.publishedAt)}
          </span>
          <br />
          <span className="text-fg-soft">SMS 短信 — 待发</span>
        </div>
        <div className="mt-auto flex gap-1.5">
          <a
            className="border border-accent bg-accent px-3 py-2 text-xs text-white hover:bg-surface-deep"
            href={`/items/${item.id}?from=alerts`}
          >
            查看详情
          </a>
          <button
            className="border border-border bg-surface px-3 py-2 text-xs text-fg-muted hover:bg-bg-deep disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={() => onDismiss(item.id)}
            type="button"
          >
            忽略
          </button>
        </div>
      </aside>
    </article>
  );
}

function groupByLevel(
  items: TimelineItemDto[]
): Record<string, TimelineItemDto[]> {
  const grouped: Record<string, TimelineItemDto[]> = {};
  for (const item of items) {
    const level = item.alertLevel ?? "L3";
    grouped[level] ??= [];
    grouped[level].push(item);
  }
  return Object.fromEntries(
    Object.entries(grouped).sort(
      ([a], [b]) =>
        (({ L1: 0, L2: 1, L3: 2 })[a] ?? 9) - ({ L1: 0, L2: 1, L3: 2 }[b] ?? 9)
    )
  );
}

function alertLabel(type: string): string {
  if (type === "own") return "自家公司";
  if (type === "legal") return "竞品涉诉";
  if (type === "safety") return "事故";
  if (type === "policy") return "政策突发";
  if (type === "risk") return "竞品风险";
  return type;
}

function channelText(type: string | null): string {
  if (type === "own") return "战略部群（4 / 4 已读）";
  if (type === "legal") return "法务合规群（2 / 6 已读）";
  if (type === "safety") return "安环群（6 / 8 已读）";
  if (type === "policy") return "技术中心群（5 / 12 已读）";
  if (type === "risk") return "竞品监测群（3 / 5 已读）";
  return "情报订阅群";
}

function alertReason(item: TimelineItemDto): string {
  if (item.alertType === "own")
    return "C1 自家公司实体命中，告警不依赖质量分门槛。";
  if (item.alertType === "legal") return "竞品或关键链条企业出现涉诉披露。";
  if (item.alertType === "safety") return "事故实体或安全风险维度触发。";
  if (item.alertType === "policy") return "T1 政策源或政策影响维度触发。";
  if (item.alertType === "risk") return "dataPro 检测到竞品风险事件。";
  return item.eventType ? `事件类型：${item.eventType}` : "规则命中";
}
