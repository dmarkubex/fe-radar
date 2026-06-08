import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";
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
    <PageFrame size="wide">
      <PageHeader
        eyebrow="/ ITEMS · QUERY"
        title="条目查询"
        description="查询已入库的情报条目，支持标题、摘要、正文关键词检索。此页使用普通列表，不使用时间轴。"
      />

      <SearchBox initialQuery={q} />

      <div className="flex items-center justify-between border-b border-border pb-2 font-mono text-[11px] tracking-[0.4px] text-fg-muted">
        <span>RESULTS · {initialData.items.length} ITEMS</span>
        <span>{q ? `QUERY · ${q}` : "LATEST"}</span>
      </div>

      <TimelineList endpoint={endpoint} initialData={initialData} />
    </PageFrame>
  );
}
