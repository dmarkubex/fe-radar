import { Suspense } from "react";
import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";
import { CuratedCategoryNav } from "@/components/curated/category-nav";
import { CuratedContent } from "@/components/curated/curated-content";
import { CuratedContentSkeleton } from "@/components/curated/curated-content-skeleton";
import { CURATED_CATEGORY_TABS } from "@/components/timeline/meta";
import { fetchTimeline } from "@/lib/api/timeline-query";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const CATEGORIES = CURATED_CATEGORY_TABS;

async function fetchCategoryStats() {
  return Promise.all(
    CATEGORIES.map(async (cat) => {
      const data = await fetchTimeline({
        filters: { curated: true, category: cat.value },
        limit: 200
      });
      return {
        ...cat,
        count: data.items.length,
        topScore: data.items[0]?.qualityScore ?? null
      };
    })
  );
}

export default async function CuratedPage({
  searchParams
}: {
  searchParams: PageSearchParams;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const category = first(params.category) ?? CATEGORIES[0].value;
  const activeCategory =
    CATEGORIES.find((c) => c.value === category) ?? CATEGORIES[0];
  const activeCategorySlug = activeCategory.value;
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
              <p className="text-sm font-semibold text-fg">≥ 50</p>
            </div>
          ))}
        </div>
      </details>

      <CuratedCategoryNav
        categories={allCategoryData}
        activeCategory={activeCategorySlug}
      />

      <Suspense key={activeCategorySlug} fallback={<CuratedContentSkeleton />}>
        <CuratedContent category={activeCategorySlug} />
      </Suspense>
    </PageFrame>
  );
}
