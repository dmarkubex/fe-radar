import { SearchBox } from "@/components/search/search-box";
import { FilterBar } from "@/components/timeline/filter-bar";
import { TimelineList } from "@/components/timeline/timeline-list";
import { auth } from "@/auth";
import { fetchTimeline } from "@/lib/api/timeline-query";
import { hasRole } from "@/lib/auth/rbac";
import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SearchPage({ searchParams }: { searchParams: PageSearchParams }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const q = first(params.q) ?? "";
  const filters = {
    category: first(params.category),
    circle: first(params.circle) as "C1" | "C2" | "C3" | undefined,
    tier: first(params.tier) as "T1" | "T2" | "T3" | undefined,
    alertType: first(params.alertType) as "own" | "safety" | "policy" | "legal" | "risk" | undefined,
    eventType: first(params.eventType)
  };
  const initialData = q ? await fetchTimeline({ search: q, filters }) : { items: [], nextCursor: null };
  const session = await auth();
  const canCreatePrediction = hasRole(session?.user?.role, "editor");
  const query = new URLSearchParams();
  query.set("q", q);
  for (const key of ["category", "circle", "tier", "alertType", "eventType"] as const) {
    const value = filters[key];
    if (value) {
      query.set(key, value);
    }
  }
  const endpoint = `/api/search?${query.toString()}`;

  return (
    <PageFrame>
      <PageHeader eyebrow="全文检索" title="搜索" variant="compact" />
      <SearchBox initialQuery={q} />
      <FilterBar />
      {q ? (
        <TimelineList
          canCreatePrediction={canCreatePrediction}
          endpoint={endpoint}
          initialData={initialData}
        />
      ) : (
        <div className="panel-surface p-8 text-sm text-fg-muted">输入关键词后开始检索</div>
      )}
    </PageFrame>
  );
}
