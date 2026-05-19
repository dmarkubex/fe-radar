import { SearchBox } from "@/components/search/search-box";
import { TimelineList } from "@/components/timeline/timeline-list";
import { fetchTimeline } from "@/lib/api/timeline-query";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ItemsPage({ searchParams }: { searchParams: PageSearchParams }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const q = first(params.q) ?? "";
  const initialData = await fetchTimeline({ search: q || undefined, limit: 50 });
  const endpoint = q ? `/api/search?q=${encodeURIComponent(q)}` : "/api/timeline";

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-6 py-8 md:px-10">
      <header className="grid grid-cols-[max-content_minmax(260px,1fr)] items-baseline gap-x-5 border-b border-hairline pb-4 max-[900px]:grid-cols-1">
        <p className="m-0 font-mono text-[10px] uppercase tracking-[1.4px] text-accent">/ ITEMS · QUERY</p>
        <div>
          <h1 className="m-0 font-display text-3xl font-normal tracking-[-0.7px] text-fg">条目查询</h1>
          <p className="mt-2 max-w-[76ch] text-sm leading-6 text-fg-muted">
            查询已入库的情报条目，支持标题、摘要、正文关键词检索。此页使用普通列表，不使用时间轴。
          </p>
        </div>
      </header>

      <SearchBox initialQuery={q} />

      <div className="flex items-center justify-between border-b border-border pb-2 font-mono text-[11px] tracking-[0.4px] text-fg-muted">
        <span>RESULTS · {initialData.items.length} ITEMS</span>
        <span>{q ? `QUERY · ${q}` : "LATEST"}</span>
      </div>

      <TimelineList endpoint={endpoint} initialData={initialData} />
    </main>
  );
}
