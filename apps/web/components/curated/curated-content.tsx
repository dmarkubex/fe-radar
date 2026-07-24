import Link from "next/link";
import { fetchTimeline } from "@/lib/api/timeline-query";
import { formatAppTime, scoreLabel, SOURCE_TIER_LABELS } from "@/components/timeline/meta";
import { safeExternalUrl } from "@/lib/safe-external-url";

export async function CuratedContent({
  category
}: {
  category: string;
}): Promise<React.JSX.Element> {
  const initialData = await fetchTimeline({
    filters: { curated: true, category }
  });
  const heroItem = initialData.items[0] ?? null;
  const gridItems = initialData.items.slice(1, 7);
  const tableItems = initialData.items.slice(7, 20);

  return (
    <>
      {heroItem ? (
        <Link
          aria-label={`查看详情：${heroItem.title}`}
          className="hero-pick grid gap-0 shell:grid-cols-[1fr_280px]"
          href={`/items/${heroItem.id}`}
        >
          <div className="border border-hairline bg-surface p-6">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <span
                className="rounded-none bg-gold px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[1px] text-accent"
                title={SOURCE_TIER_LABELS[heroItem.sourceTier as keyof typeof SOURCE_TIER_LABELS] ?? heroItem.sourceTier}
              >
                {heroItem.sourceTier}
              </span>
              {heroItem.topCircle ? (
                <span className="rounded-none bg-surface-warm px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[1px] text-fg-muted">
                  {heroItem.topCircle}
                </span>
              ) : null}
              <span className="font-mono text-[10px] text-fg-soft">
                {heroItem.sourceName}
              </span>
              {heroItem.acquisitionLabel ? (
                <span className="border border-accent/30 bg-accent/8 px-2 py-0.5 font-mono text-[10px] text-accent">
                  {heroItem.acquisitionLabel}
                </span>
              ) : null}
              <span className="font-mono text-[10px] text-fg-soft">
                {formatAppTime(heroItem.scoredAt)}
              </span>
            </div>
            <h2 className="mt-3 text-xl font-semibold leading-7 text-fg">
              {heroItem.title}
            </h2>
            {heroItem.summaryZh ? (
              <p className="mt-2 text-sm leading-6 text-fg-muted">
                {heroItem.summaryZh}
              </p>
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

          <div className="signal-panel border border-hairline bg-bg-deep p-5 shell:border-l-0">
            <p className="font-mono text-[13px] font-medium uppercase tracking-[1.4px] text-fg-soft">
              综合评分
            </p>
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-accent">
              {scoreLabel(heroItem.qualityScore)}
            </p>
            <div className="mt-4">
              <div className="h-1.5 rounded-none bg-border">
                <div
                  className="h-full rounded-none bg-accent"
                  style={{
                    width:
                      heroItem.qualityScore !== null
                        ? `${Math.min(100, Math.max(0, heroItem.qualityScore))}%`
                        : "0%"
                  }}
                />
              </div>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[1px] text-fg-soft">
                0-100 · 质量分
              </p>
            </div>
            {heroItem.alertType ? (
              <div className="mt-4 rounded-none border border-danger/30 bg-danger/5 px-3 py-2">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[1px] text-danger">
                  告警 · {heroItem.alertType}
                </p>
                {heroItem.alertLevel ? (
                  <p className="mt-0.5 text-xs text-danger/70">
                    {heroItem.alertLevel}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </Link>
      ) : (
        <div className="border border-hairline bg-surface px-6 py-12 text-center text-sm text-fg-muted">
          该分类暂无精选条目
        </div>
      )}

      {gridItems.length > 0 ? (
        <section className="pick-grid grid gap-4 shell:grid-cols-3">
          {gridItems.map((item) => (
            <Link
              aria-label={`查看详情：${item.title}`}
              key={item.id}
              className="group flex flex-col gap-3 border border-hairline bg-surface p-5 transition-colors hover:border-border-strong"
              href={`/items/${item.id}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                <span
                  className="rounded-none bg-gold px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[1px] text-accent"
                  title={SOURCE_TIER_LABELS[item.sourceTier as keyof typeof SOURCE_TIER_LABELS] ?? item.sourceTier}
                >
                  {item.sourceTier}
                </span>
                {item.topCircle ? (
                  <span className="rounded-none bg-surface-warm px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[1px] text-fg-muted">
                    {item.topCircle}
                  </span>
                ) : null}
                <span className="font-mono text-[10px] text-fg-soft">
                  {item.sourceName}
                </span>
                {item.acquisitionLabel ? (
                  <span className="border border-accent/30 bg-accent/8 px-2 py-0.5 font-mono text-[10px] text-accent">
                    {item.acquisitionLabel}
                  </span>
                ) : null}
              </div>
              <h3 className="text-sm font-semibold leading-6 text-fg">
                {item.title}
              </h3>
              {item.summaryZh ? (
                <p className="line-clamp-2 text-xs leading-5 text-fg-muted">
                  {item.summaryZh}
                </p>
              ) : null}
              <div className="mt-auto flex items-center justify-between gap-3 border-t border-hairline pt-3">
                <div className="flex flex-wrap gap-1">
                  {item.category ? (
                    <span className="rounded-none border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-fg-soft">
                      {item.category}
                    </span>
                  ) : null}
                </div>
                <span className="font-mono text-sm font-semibold tabular-nums text-accent">
                  {scoreLabel(item.qualityScore)}
                </span>
              </div>
            </Link>
          ))}
        </section>
      ) : null}

      {tableItems.length > 0 ? (
        <section className="table-section">
          <h2 className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[1.4px] text-fg-soft">
            同主题更多
          </h2>
          <div className="hidden overflow-x-auto rounded-none border border-border shell:block">
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
                {tableItems.map((item) => {
                  const displayUrl = safeExternalUrl(item.displayUrl);
                  return (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap">
                      <span
                        className="rounded-none bg-gold px-1.5 py-0.5 font-mono text-[10px] text-accent"
                        title={SOURCE_TIER_LABELS[item.sourceTier as keyof typeof SOURCE_TIER_LABELS] ?? item.sourceTier}
                      >
                        {item.sourceTier}
                      </span>
                      <span className="ml-2 text-xs text-fg-muted">
                        {item.sourceName}
                      </span>
                    </td>
                    <td className="max-w-[400px] break-words">
                      {displayUrl ? (
                        <a
                          href={displayUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-fg hover:text-accent"
                        >
                          {item.title}
                        </a>
                      ) : (
                        <span className="inline-flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                          {item.title}
                          <span className="border border-accent/30 bg-accent/8 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                            {item.acquisitionLabel ?? "AI获取"}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap font-mono text-[10px] text-fg-soft">
                      {formatAppTime(item.scoredAt)}
                    </td>
                    <td className="num font-mono text-sm font-semibold tabular-nums text-accent">
                      {scoreLabel(item.qualityScore)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 shell:hidden">
            {tableItems.map((item) => (
              <Link
                aria-label={`查看详情：${item.title}`}
                className="border border-border bg-surface p-4"
                href={`/items/${item.id}`}
                key={item.id}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] text-accent">
                    {item.sourceTier} · {item.sourceName}
                  </span>
                  <span className="font-mono text-sm font-semibold tabular-nums text-accent">
                    {scoreLabel(item.qualityScore)}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium leading-6 text-fg">
                  {item.title}
                </p>
                <p className="mt-2 font-mono text-[10px] text-fg-soft">
                  {formatAppTime(item.scoredAt)}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
