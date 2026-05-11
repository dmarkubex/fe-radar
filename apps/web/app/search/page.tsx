import { SearchBox } from "@/components/search/search-box";
import { FilterBar } from "@/components/timeline/filter-bar";
import { TimelineList } from "@/components/timeline/timeline-list";
import { fetchTimeline } from "@/lib/api/timeline-query";

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
    alertType: first(params.alertType) as "own" | "safety" | "policy" | undefined,
    eventType: first(params.eventType)
  };
  const initialData = q ? await fetchTimeline({ search: q, filters }) : { items: [], nextCursor: null };
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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium text-zinc-500">全文检索</p>
        <h1 className="text-2xl font-semibold text-zinc-950">搜索</h1>
      </header>
      <SearchBox initialQuery={q} />
      <FilterBar />
      {q ? <TimelineList endpoint={endpoint} initialData={initialData} /> : <div className="rounded-lg border border-zinc-200 bg-white p-8 text-sm text-zinc-500">输入关键词后开始检索</div>}
    </main>
  );
}
