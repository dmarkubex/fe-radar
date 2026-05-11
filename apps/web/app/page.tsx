import { FilterBar } from "@/components/timeline/filter-bar";
import { TimelineList } from "@/components/timeline/timeline-list";
import { fetchTimeline } from "@/lib/api/timeline-query";

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
    alertType: first(params.alertType) as "own" | "safety" | "policy" | undefined,
    eventType: first(params.eventType)
  };
  const initialData = await fetchTimeline({ filters });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium text-zinc-500">产业情报雷达</p>
        <h1 className="text-2xl font-semibold text-zinc-950">时间线</h1>
      </header>
      <FilterBar />
      <TimelineList endpoint={endpointFromParams(params)} initialData={initialData} />
    </main>
  );
}
