import { CATEGORY_TABS } from "@/components/timeline/meta";
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

export default async function CuratedPage({ searchParams }: { searchParams: PageSearchParams }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const category = first(params.category) ?? CATEGORIES[0].value;
  const initialData = await fetchTimeline({ filters: { curated: true, category } });

  const allCategoryData = await Promise.all(
    CATEGORIES.map(async (cat) => {
      const data = await fetchTimeline({ filters: { curated: true, category: cat.value }, limit: 200 });
      return { ...cat, count: data.items.length, topScore: data.items[0]?.qualityScore ?? null };
    })
  );

  const heroItem = initialData.items[0] ?? null;
  const gridItems = initialData.items.slice(1, 7);
  const tableItems = initialData.items.slice(7, 20);
  const activeCategory = CATEGORIES.find((c) => c.value === category) ?? CATEGORIES[0];

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-5 py-6 md:px-8">
      <header className="page-head pb-4">
        <p className="eyebrow font-mono text-[10px] font-medium uppercase tracking-[2px] text-fg-soft">
          精选 &middot; CURATED
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-fg">
          {activeCategory.label}
        </h1>
        <p className="deck mt-1 text-sm leading-relaxed text-fg-muted">
          每条目经 5 维评分后按质量排序；低于阈值条目自动滤除。点击卡片查看完整分析与实体。
        </p>
        <details className="mt-2">
          <summary className="cursor-pointer font-mono text-[10px] font-medium uppercase tracking-[1.2px] text-accent hover:text-accent-flame">
            评分阈值详情
          </summary>
          <div className="mt-2 grid grid-cols-5 gap-2 rounded-none border border-hairline bg-surface p-3">
            {["D1 政策", "D2 链条", "D3 市场", "D4 技术", "D5 商业"].map((d) => (
              <div key={d} className="text-center">
                <p className="font-mono text-[10px] text-fg-soft">{d}</p>
                <p className="text-sm font-semibold text-fg">≥ 5.0</p>
              </div>
            ))}
          </div>
        </details>
      </header>

      <div className="category-strip grid grid-cols-5 gap-0 border border-border-strong">
        {allCategoryData.map((cat) => (
          <a
            key={cat.value}
            href={`/curated?category=${cat.value}`}
            className={`group flex flex-col items-center gap-1 border-r border-hairline px-3 py-4 last:border-r-0 transition-colors ${
              category === cat.value
                ? "bg-surface-deep text-fg-on-dark"
                : "bg-surface text-fg hover:bg-surface-warm"
            }`}
          >
            <span className={`font-mono text-lg ${category === cat.value ? "text-fg-on-dark" : "text-accent"}`}>
              {cat.icon}
            </span>
            <span className={`text-[10px] font-medium uppercase tracking-[1px] ${
              category === cat.value ? "text-fg-on-dark" : "text-fg-soft"
            }`}>
              {cat.label}
            </span>
            <span className={`font-mono text-xl font-semibold tabular-nums ${
              category === cat.value ? "text-fg-on-dark" : "text-fg"
            }`}>
              {cat.count}
            </span>
            {cat.topScore !== null ? (
              <span className={`font-mono text-[10px] ${
                category === cat.value ? "text-fg-on-dark/70" : "text-fg-muted"
              }`}>
                ▲ {cat.topScore.toFixed(1)}
              </span>
            ) : null}
          </a>
        ))}
      </div>

      <div className="tab-strip flex gap-0 border-b border-border-strong">
        {CATEGORY_TABS.map((tab) => (
          <a
            key={tab.value}
            href={`/curated?category=${tab.value}`}
            className={`border-b-2 px-5 py-2.5 text-sm font-medium transition-colors ${
              category === tab.value
                ? "border-accent text-accent"
                : "border-transparent text-fg-muted hover:text-fg"
            }`}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {heroItem ? (
        <section className="hero-pick grid gap-0 sm:grid-cols-[1fr_280px]">
          <div className="border border-hairline bg-surface p-6">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <span className="rounded-none bg-gold px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[1px] text-accent">
                {heroItem.sourceTier}
              </span>
              {heroItem.topCircle ? (
                <span className="rounded-none bg-surface-warm px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[1px] text-fg-muted">
                  {heroItem.topCircle}
                </span>
              ) : null}
              <span className="font-mono text-[10px] text-fg-soft">{heroItem.sourceName}</span>
              <span className="font-mono text-[10px] text-fg-soft">
                {heroItem.scoredAt
                  ? new Date(heroItem.scoredAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                  : "-"}
              </span>
            </div>
            <h2 className="mt-3 text-xl font-semibold leading-7 text-fg">
              {heroItem.title}
            </h2>
            {heroItem.summaryZh ? (
              <p className="mt-2 text-sm leading-6 text-fg-muted">{heroItem.summaryZh}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {heroItem.category ? (
                <span className="rounded-none border border-hairline px-2 py-1 font-mono text-[10px] uppercase tracking-[1px] text-fg-muted">
                  {heroItem.category}
                </span>
              ) : null}
              {heroItem.eventType ? (
                <span className="rounded-none border border-hairline px-2 py-1 font-mono text-[10px] uppercase tracking-[1px] text-fg-muted">
                  {heroItem.eventType}
                </span>
              ) : null}
              {heroItem.relatedCount > 0 ? (
                <span className="rounded-none border border-hairline px-2 py-1 font-mono text-[10px] uppercase tracking-[1px] text-fg-muted">
                  关联 {heroItem.relatedCount}
                </span>
              ) : null}
            </div>
          </div>

          <div className="signal-panel border border-l-0 border-hairline bg-bg-deep p-5">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[1.4px] text-fg-soft">
              综合评分
            </p>
            <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-accent">
              {heroItem.qualityScore !== null ? heroItem.qualityScore.toFixed(1) : "-"}
            </p>
            <div className="mt-4 space-y-2">
              {[
                { label: "D1", key: "d1Policy" as const },
                { label: "D2", key: "d2Chain" as const },
                { label: "D3", key: "d3Market" as const },
                { label: "D4", key: "d4Tech" as const },
                { label: "D5", key: "d5Business" as const },
              ].map((dim) => (
                <div key={dim.key} className="flex items-center gap-2">
                  <span className="w-6 font-mono text-[10px] text-fg-soft">{dim.label}</span>
                  <div className="h-1.5 flex-1 rounded-none bg-border">
                    <div
                      className="h-full rounded-none bg-accent"
                      style={{ width: heroItem.qualityScore !== null ? `${Math.min(100, heroItem.qualityScore * 10)}%` : "0%" }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {heroItem.alertType ? (
              <div className="mt-4 rounded-none border border-danger/30 bg-danger/5 px-3 py-2">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[1px] text-danger">
                  告警 · {heroItem.alertType}
                </p>
                {heroItem.alertLevel ? (
                  <p className="mt-0.5 text-xs text-danger/70">{heroItem.alertLevel}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {gridItems.length > 0 ? (
        <section className="pick-grid grid gap-4 sm:grid-cols-3">
          {gridItems.map((item) => (
            <article key={item.id} className="group flex flex-col gap-3 border border-hairline bg-surface p-5 transition-shadow hover:shadow-card">
              <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                <span className="rounded-none bg-gold px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[1px] text-accent">
                  {item.sourceTier}
                </span>
                {item.topCircle ? (
                  <span className="rounded-none bg-surface-warm px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[1px] text-fg-muted">
                    {item.topCircle}
                  </span>
                ) : null}
                <span className="font-mono text-[10px] text-fg-soft">{item.sourceName}</span>
              </div>
              <h3 className="text-sm font-semibold leading-6 text-fg">{item.title}</h3>
              {item.summaryZh ? (
                <p className="line-clamp-2 text-xs leading-5 text-fg-muted">{item.summaryZh}</p>
              ) : null}
              <div className="mt-auto flex items-center justify-between border-t border-hairline pt-3">
                <div className="flex flex-wrap gap-1">
                  {item.category ? (
                    <span className="rounded-none border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-fg-soft">
                      {item.category}
                    </span>
                  ) : null}
                </div>
                <span className="font-mono text-sm font-semibold tabular-nums text-accent">
                  {item.qualityScore !== null ? item.qualityScore.toFixed(1) : "-"}
                </span>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {tableItems.length > 0 ? (
        <section className="table-section">
          <h2 className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[1.4px] text-fg-soft">
            同主题更多
          </h2>
          <div className="overflow-x-auto rounded-none border border-border">
            <table className="fr">
              <thead>
                <tr>
                  <th>信源</th>
                  <th>标题</th>
                  <th>时间</th>
                  <th className="text-end">评分</th>
                </tr>
              </thead>
              <tbody>
                {tableItems.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap">
                      <span className="rounded-none bg-gold px-1.5 py-0.5 font-mono text-[10px] text-accent">
                        {item.sourceTier}
                      </span>
                      <span className="ml-2 text-xs text-fg-muted">{item.sourceName}</span>
                    </td>
                    <td className="max-w-[400px]">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-fg hover:text-accent"
                      >
                        {item.title}
                      </a>
                    </td>
                    <td className="whitespace-nowrap font-mono text-[10px] text-fg-soft">
                      {item.scoredAt
                        ? new Date(item.scoredAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                        : "-"}
                    </td>
                    <td className="num font-mono text-sm font-semibold tabular-nums text-accent">
                      {item.qualityScore !== null ? item.qualityScore.toFixed(1) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

    </main>
  );
}
