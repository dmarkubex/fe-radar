import { CATEGORY_TABS } from "@/components/timeline/meta";
import { TimelineList } from "@/components/timeline/timeline-list";
import { fetchTimeline } from "@/lib/api/timeline-query";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CuratedPage({ searchParams }: { searchParams: PageSearchParams }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const category = first(params.category) ?? CATEGORY_TABS[0]?.value;
  const endpoint = `/api/timeline?curated=true${category ? `&category=${encodeURIComponent(category)}` : ""}`;
  const initialData = await fetchTimeline({ filters: { curated: true, category } });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium text-zinc-500">精选条目</p>
        <h1 className="text-2xl font-semibold text-zinc-950">精选</h1>
      </header>
      <div className="flex flex-wrap gap-2 rounded-lg border border-zinc-200 bg-white p-3">
        {CATEGORY_TABS.map((tab) => (
          <a
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${category === tab.value ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}
            href={`/curated?category=${tab.value}`}
            key={tab.value}
          >
            {tab.label}
          </a>
        ))}
      </div>
      <TimelineList endpoint={endpoint} initialData={initialData} />
    </main>
  );
}
