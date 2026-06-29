import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";
import { FilterBar } from "@/components/timeline/filter-bar";
import { TimelineList } from "@/components/timeline/timeline-list";
import { auth } from "@/auth";
import { fetchTimeline } from "@/lib/api/timeline-query";
import { hasRole } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function endpointFromParams(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const key of ["category", "circle", "tier", "alertType", "eventType"]) {
    const value = first(params[key]);
    if (value) {
      query.set(key, value);
    }
  }
  const suffix = query.toString();
  return `/api/timeline${suffix ? `?${suffix}` : ""}`;
}

export default async function HomePage({ searchParams }: { searchParams: PageSearchParams }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const filters = {
    category: first(params.category),
    circle: first(params.circle) as "C1" | "C2" | "C3" | undefined,
    tier: first(params.tier) as "T1" | "T2" | "T3" | undefined,
    alertType: first(params.alertType) as "own" | "safety" | "policy" | "legal" | "risk" | undefined,
    eventType: first(params.eventType)
  };
  const initialData = await fetchTimeline({ filters });
  const session = await auth();
  const canCreatePrediction = hasRole(session?.user?.role, "editor");

  const totalCount = initialData.items.length;
  const alertCount = initialData.items.filter((i) => i.alertType === "own").length;
  const filteredCount = initialData.items.filter((i) => i.topCircle === "C1" || i.topCircle === "C2").length;

  return (
    <PageFrame size="wide">
      <PageHeader
        eyebrow="时间线 · TIMELINE"
        title="全量信息流"
        description="时间倒序排列，每条经 8 阶段 pipeline 处理：去重、NER、5 维评分、聚簇、告警判定。左侧色条 = 关注圈 / 告警类型，右侧评分面板可展开详情。"
      />

      <div className="stats-bar grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatsCell label="全量" value={String(totalCount)} />
        <StatsCell label="命中筛选" value={String(filteredCount)} sub="C1+C2" />
        <StatsCell label="自家告警" value={String(alertCount)} accent />
        <StatsCell label="下次抓取" value="06:00" sub="CST" />
      </div>

      <FilterBar />

      <TimelineList
        canCreatePrediction={canCreatePrediction}
        endpoint={endpointFromParams(params)}
        initialData={initialData}
        variant="timeline"
      />
    </PageFrame>
  );
}

function StatsCell({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 rounded-none border border-hairline bg-surface px-4 py-3">
      <span className="font-mono text-[10px] font-medium uppercase tracking-[1.2px] text-fg-soft">
        {label}
      </span>
      <span className={`text-2xl font-semibold tabular-nums ${accent ? "text-danger" : "text-fg"}`}>
        {value}
        {sub ? <span className="ml-1 text-xs font-normal text-fg-soft">{sub}</span> : null}
      </span>
    </div>
  );
}
