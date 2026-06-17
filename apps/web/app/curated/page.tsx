import { Suspense } from "react";
import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";
import { CuratedCategoryNav } from "@/components/curated/category-nav";
import { CuratedContent } from "@/components/curated/curated-content";
import { CuratedContentSkeleton } from "@/components/curated/curated-content-skeleton";
import { fetchTimeline } from "@/lib/api/timeline-query";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const CATEGORIES = [
  { value: "policy", label: "政策与标准", icon: "§" },
  { value: "market", label: "市场与价格", icon: "$" },
  { value: "tech", label: "技术与产品", icon: "⚙" },
  { value: "project", label: "项目与招投标", icon: "⚑" },
  { value: "company", label: "公司与资本", icon: "▶" },
] as const;

async function fetchCategoryStats() {
  return Promise.all(
    CATEGORIES.map(async (cat) => {
      const data = await fetchTimeline({ filters: { curated: true, category: cat.value }, limit: 200 });
      return { ...cat, count: data.items.length, topScore: data.items[0]?.qualityScore ?? null };
    })
  );
}

export default async function CuratedPage({ searchParams }: { searchParams: PageSearchParams }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const category = first(params.category) ?? CATEGORIES[0].value;
  const activeCategory = CATEGORIES.find((c) => c.value === category) ?? CATEGORIES[0];
  const allCategoryData = await fetchCategoryStats();

  return (
    <PageFrame size="wide">
      <PageHeader
        eyebrow="精选 · CURATED"
        title={activeCategory.label}
        description="每条目经 5 维评分后按质量排序；低于阈值条目自动滤除。点击卡片查看完整分析与实体。"
      />

      <details className="mt-2">
        <summary className="cursor-pointer font-mono text-[10px] font-medium uppercase tracking-[1.2px] text-accent hover:text-accent-flame">
          评分阈值详情
        </summary>
        <div className="mt-2 grid grid-cols-5 gap-2 rounded-none border border-hairline bg-surface p-3">
          {["D1 政策", "D2 链条", "D3 市场", "D4 技术", "D5 商业"].map((d) => (
            <div key={d} className="text-center">
              <p className="font-mono text-[12px] text-fg-soft">{d}</p>
              <p className="text-sm font-semibold text-fg">≥ 5.0</p>
            </div>
          ))}
        </div>
      </details>

      <CuratedCategoryNav categories={allCategoryData} activeCategory={category} />

      <Suspense key={category} fallback={<CuratedContentSkeleton />}>
        <CuratedContent category={category} />
      </Suspense>
    </PageFrame>
  );
}
