import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";
import { SearchBox } from "@/components/search/search-box";
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
  const q = first(params.q);
  if (q) query.set("q", q);
  for (const key of ["category", "circle", "tier", "alertType", "eventType"]) {
    const value = first(params[key]);
    if (value) query.set(key, value);
  }
  const suffix = query.toString();
  if (first(params.q)) {
    return `/api/search${suffix ? `?${suffix}` : ""}`;
  }
  return `/api/timeline${suffix ? `?${suffix}` : ""}`;
}

export default async function ItemsPage({ searchParams }: { searchParams: PageSearchParams }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const q = first(params.q) ?? "";
  const filters = {
    category: first(params.category),
    circle: first(params.circle) as "C1" | "C2" | "C3" | undefined,
    tier: first(params.tier) as "T1" | "T2" | "T3" | undefined,
    alertType: first(params.alertType) as "own" | "safety" | "policy" | "legal" | "risk" | undefined,
    eventType: first(params.eventType),
  };
  const initialData = await fetchTimeline({ search: q || undefined, filters, limit: 50 });
  const endpoint = endpointFromParams(params);
  const session = await auth();
  const canCreatePrediction = hasRole(session?.user?.role, "editor");

  return (
    <PageFrame size="wide">
      <PageHeader
        eyebrow="/ ITEMS · QUERY"
        title="条目查询"
        description="查询已入库的情报条目，支持标题、摘要、正文关键词检索。此页使用普通列表，不使用时间轴。"
      />

      <SearchBox initialQuery={q} />

      <FilterBar />

      <div className="flex items-center justify-between border-b border-border pb-2 font-mono text-[11px] tracking-[0.4px] text-fg-muted">
        <span>RESULTS · {initialData.items.length} ITEMS</span>
        <span>{q ? `QUERY · ${q}` : "LATEST"}</span>
      </div>

      <TimelineList
        canCreatePrediction={canCreatePrediction}
        endpoint={endpoint}
        initialData={initialData}
      />
    </PageFrame>
  );
}
