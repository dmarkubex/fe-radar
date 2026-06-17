import { fetchAlerts, fetchAlertCount } from "@/lib/api/alerts-query";
import { formatAppTime } from "@/components/timeline/meta";
import { ExternalLink } from "lucide-react";

import type { TimelineItemDto } from "@/lib/api/timeline-query";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const LEVEL_META: Record<string, { title: string; small: string; pri: string; card: string }> = {
  L1: { title: "P1 · 立即响应", small: "CONDITION · ESCALATED", pri: "P1 紧急", card: "border-danger border-l-4" },
  L2: { title: "P2 · 关注", small: "CONDITIONS · 待审阅", pri: "P2 关注", card: "border-border" },
  L3: { title: "P3 · 留底", small: "CONDITIONS · 信息备忘", pri: "P3 留底", card: "border-border" }
};

export default async function AlertsPage({ searchParams }: { searchParams: PageSearchParams }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const filterType = first(params.type) as "own" | "safety" | "policy" | "legal" | undefined;
  const filterLevel = first(params.level) as "L1" | "L2" | "L3" | undefined;

  const [{ items }, counts] = await Promise.all([
    fetchAlerts({ type: filterType, level: filterLevel, limit: 50 }),
    fetchAlertCount()
  ]);

  const total = counts.own + counts.safety + counts.policy + counts.legal;
  const p1Count = items.filter((i) => i.alertLevel === "L1").length;
  const grouped = groupByLevel(items);

  return (
    <main>
      <header className="grid grid-cols-[max-content_minmax(260px,360px)_minmax(0,1fr)] items-baseline gap-x-[18px] border-b border-hairline pad-fluid-x py-5 max-[1100px]:grid-cols-1 max-[1100px]:gap-y-1">
        <div className="font-mono text-[10px] font-medium uppercase tracking-[1.4px] text-fg-soft">/ ALERTS · 24H</div>
        <h1 className="m-0 display-fluid font-semibold tracking-tight text-fg">
          {total} 条告警 · {p1Count} 条 P1 需立即关注
        </h1>
        <p className="m-0 text-xs leading-6 text-fg-muted">
          四类告警共用通道：<b className="font-normal text-fg">自家公司</b>（C1 + 总分 ≥70）· <b className="font-normal text-fg">竞品涉诉</b>（C2 + 交易所涉诉公告）· <b className="font-normal text-fg">安全事故</b>（NER=事故 + D5 ≥70）· <b className="font-normal text-fg">政策突发</b>（T1 政府 + D1 ≥80）。订阅规则可推送至钉钉群。
        </p>
      </header>

      <div className="pad-fluid-x py-5">
        <div className="mb-4 grid grid-cols-2 gap-px border border-border bg-border max-[720px]:grid-cols-1 sm:grid-cols-4">
          <SummaryCell active={filterType === "own"} href="/alerts?type=own" count={counts.own} label="自家公司 · C1" delta="含 P1 事故与中标动态" pip="bg-accent" />
          <SummaryCell active={filterType === "legal"} href="/alerts?type=legal" count={counts.legal} label="竞品涉诉 · C2" delta="交易所法定披露" pip="bg-fg" />
          <SummaryCell active={filterType === "safety"} href="/alerts?type=safety" count={counts.safety} label="安全事故" delta="行业内 · 最近 6h" pip="bg-warn" />
          <SummaryCell active={filterType === "policy"} href="/alerts?type=policy" count={counts.policy} label="政策突发" delta="能源局 / 工信部政策" pip="bg-sunshine-700" />
        </div>

        {Object.entries(grouped).map(([level, group]) => {
          const meta = LEVEL_META[level] ?? LEVEL_META.L3!;
          return (
            <section key={level}>
              <div className="my-5 flex items-center gap-3.5">
                <h2 className="m-0 font-display text-lg font-normal tracking-[-0.3px] text-fg">{meta.title}</h2>
                <div className="h-px flex-1 bg-border" />
                <small className="font-mono text-[10px] uppercase tracking-[1px] text-fg-soft">{group.length} {meta.small}</small>
              </div>
              {group.map((item) => <BigAlert key={item.id} item={item} level={level} />)}
            </section>
          );
        })}

        {items.length === 0 ? <div className="py-20 text-center text-sm text-fg-soft">当前筛选条件下无告警</div> : null}
      </div>
    </main>
  );
}

function SummaryCell({ active, href, count, label, delta, pip }: { active: boolean; href: string; count: number; label: string; delta: string; pip: string }): React.JSX.Element {
  return (
    <a href={active ? "/alerts" : href} className={`flex items-center gap-3.5 p-4 ${active ? "bg-surface-deep text-white" : "bg-surface text-fg hover:bg-bg-deep"}`}>
      <b className="min-w-10 font-display text-3xl font-normal leading-none tracking-[-0.6px] tabular-nums">{count}</b>
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-2 font-mono text-[13px] uppercase tracking-[1.4px] ${active ? "text-sunshine-500" : "text-fg-soft"}`}><i className={`h-1.5 w-1.5 rounded-full ${pip}`} />{label}</span>
        <span className={`block font-mono text-[12px] ${active ? "text-white/70" : "text-fg-muted"}`}>{delta}</span>
      </span>
    </a>
  );
}

function BigAlert({ item, level }: { item: TimelineItemDto; level: string }): React.JSX.Element {
  const meta = LEVEL_META[level] ?? LEVEL_META.L3!;
  const priClass = level === "L1" ? "bg-danger" : level === "L2" ? "bg-warn" : "bg-fg";
  const score = item.qualityScore !== null ? Math.round(item.qualityScore * 10) : null;

  return (
    <article className={`mb-2.5 grid grid-cols-[1fr_220px] items-start gap-7 border bg-surface px-5 py-[18px] max-[1100px]:grid-cols-1 ${meta.card}`}>
      <div className="min-w-0">
        <div className="mb-2.5 flex flex-wrap items-center gap-2 font-mono text-[11px] tracking-[0.6px] text-fg-soft">
          <span className={`${priClass} px-2 py-1 text-[10px] uppercase tracking-[1.4px] text-white`}>{meta.pri}</span>
          <span className="font-mono text-xs text-fg">{formatAppTime(item.scoredAt ?? item.publishedAt)}</span>
          <span className="text-border-strong">·</span>
          <span className="border border-border bg-bg-deep px-2 py-0.5">{item.sourceTier}</span>
          {item.topCircle ? <span className="border border-border bg-bg-deep px-2 py-0.5">{item.topCircle}</span> : null}
          {item.alertType ? <span className="border border-border bg-bg-deep px-2 py-0.5">{alertLabel(item.alertType)}</span> : null}
          <span>{item.sourceName}</span>
        </div>
        <h3 className="mb-2 font-display text-xl font-normal leading-[1.3] tracking-[-0.4px] text-fg">
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-2 hover:text-accent">
            {item.title}<ExternalLink className="mt-1 h-4 w-4 shrink-0 text-fg-soft" />
          </a>
        </h3>
        {item.summaryZh ? <p className="m-0 max-w-[72ch] text-[13px] leading-[1.65] text-fg-muted">{item.summaryZh}</p> : null}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.topCircle === "C1" ? <span className="border border-surface-deep bg-surface-deep px-2 py-1 text-[11px] text-white">C1 自家</span> : null}
          {item.eventType ? <span className="border border-border bg-bg-deep px-2 py-1 text-[11px] text-fg-muted">{item.eventType}</span> : null}
          {item.category ? <span className="border border-border bg-bg-deep px-2 py-1 text-[11px] text-fg-muted">{item.category}</span> : null}
          {item.relatedCount > 0 ? <span className="border border-border bg-bg-deep px-2 py-1 text-[11px] text-fg-muted">关联 {item.relatedCount}</span> : null}
        </div>
      </div>

      <aside className="flex min-h-full flex-col gap-3 border-l border-hairline pl-6 max-[1100px]:border-l-0 max-[1100px]:border-t max-[1100px]:pl-0 max-[1100px]:pt-4">
        <div className="flex items-baseline justify-between border-b border-hairline pb-2.5">
          <small className="font-mono text-[12px] uppercase tracking-[1.2px] text-fg-soft">综合得分</small>
          <b className="font-display text-[32px] font-normal leading-none tracking-[-0.8px] text-accent">{score ?? "-"}</b>
        </div>
        <div className="font-mono text-[12px] leading-[1.75] tracking-[0.2px] text-fg-muted">
          <b className="mb-1 block text-[12px] font-normal uppercase tracking-[1.2px] text-fg">已推送</b>
          · {channelText(item.alertType)}<br />
          <span className="text-ok">✓ 钉钉机器人 {formatAppTime(item.scoredAt ?? item.publishedAt)}</span><br />
          <span className="text-fg-soft">SMS 短信 — 待发</span>
        </div>
        <div className="mt-auto flex gap-1.5">
          <a className="border border-accent bg-accent px-3 py-2 text-xs text-white hover:bg-surface-deep" href={`/items/${item.id}`}>查看详情</a>
          <button className="border border-border bg-surface px-3 py-2 text-xs text-fg-muted hover:bg-bg-deep" type="button">忽略</button>
        </div>
      </aside>
    </article>
  );
}

function groupByLevel(items: TimelineItemDto[]): Record<string, TimelineItemDto[]> {
  const grouped: Record<string, TimelineItemDto[]> = {};
  for (const item of items) {
    const level = item.alertLevel ?? "L3";
    grouped[level] ??= [];
    grouped[level].push(item);
  }
  return Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => ({ L1: 0, L2: 1, L3: 2 }[a] ?? 9) - ({ L1: 0, L2: 1, L3: 2 }[b] ?? 9)));
}

function alertLabel(type: string): string {
  if (type === "own") return "自家公司";
  if (type === "legal") return "竞品涉诉";
  if (type === "safety") return "事故";
  if (type === "policy") return "政策突发";
  return type;
}

function channelText(type: string | null): string {
  if (type === "own") return "战略部群（4 / 4 已读）";
  if (type === "legal") return "法务合规群（2 / 6 已读）";
  if (type === "safety") return "安环群（6 / 8 已读）";
  if (type === "policy") return "技术中心群（5 / 12 已读）";
  return "情报订阅群";
}
