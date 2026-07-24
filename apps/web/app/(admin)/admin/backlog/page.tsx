import { and, desc, eq } from "drizzle-orm";
import { getDb, itemAnalysis, items, sources } from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";
import Link from "next/link";
import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const FILTERS = [
  { state: undefined, label: "全部" },
  { state: "pending_over_quota", label: "待处理" },
  { state: "dropped_quota_expired", label: "已丢弃" },
] as const;

function quotaLabel(state: string | null): string {
  if (state === "pending_over_quota") return "待处理";
  if (state === "dropped_quota_expired") return "超时丢弃";
  return state ?? "未知";
}

export default async function AdminBacklogPage({ searchParams }: { searchParams: PageSearchParams }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const state = first(params.state) as "pending_over_quota" | "dropped_quota_expired" | undefined;
  const rows = await getDb()
    .select({
      id: items.id,
      title: items.title,
      sourceName: sources.name,
      fetchedAt: items.fetchedAt,
      quotaState: itemAnalysis.quotaState,
      summaryZh: itemAnalysis.summaryZh
    })
    .from(items)
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .innerJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id))
    .where(and(state ? eq(itemAnalysis.quotaState, state) : undefined))
    .orderBy(desc(items.fetchedAt), desc(items.id))
    .limit(100);

  return (
    <PageFrame>
      <PageHeader
        eyebrow="/ 后台 · ADMIN · BACKLOG"
        title="Backlog 抽查"
        description="查看超出评分配额的待处理与超时丢弃条目。"
      />
      <nav aria-label="Backlog 状态" className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => {
          const active = state === filter.state;
          const href = filter.state ? `/admin/backlog?state=${filter.state}` : "/admin/backlog";
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-10 items-center px-3 py-1.5 font-mono text-xs ${
                active
                  ? "bg-accent text-white"
                  : "border border-border bg-surface text-fg-muted hover:bg-bg-deep"
              }`}
              href={href}
              key={filter.label}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      <section className="panel-surface">
        {rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-fg-muted">当前筛选条件下暂无 backlog 条目。</p>
        ) : (
          <>
            <div className="divide-y divide-hairline md:hidden">
              {rows.map((row) => (
                <article className="space-y-2 p-4" key={row.id}>
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-sm font-medium text-fg">{row.title}</h2>
                    <span className="shrink-0 bg-bg-deep px-2 py-1 font-mono text-[10px] text-fg-muted">
                      {quotaLabel(row.quotaState)}
                    </span>
                  </div>
                  {row.summaryZh ? <p className="line-clamp-3 text-sm text-fg-muted">{row.summaryZh}</p> : null}
                  <p className="font-mono text-[11px] text-fg-soft">
                    {row.sourceName} · {dayjs(row.fetchedAt).tz(APP_TIMEZONE).format("YYYY-MM-DD HH:mm")}
                  </p>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-bg font-mono text-[11px] uppercase text-fg-soft">
                  <tr>
                    <th className="px-4 py-3 font-medium">条目</th>
                    <th className="px-4 py-3 font-medium">信源</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">抓取时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="max-w-xl px-4 py-3">
                        <p className="font-medium text-fg">{row.title}</p>
                        {row.summaryZh ? <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{row.summaryZh}</p> : null}
                      </td>
                      <td className="px-4 py-3 text-fg-muted">{row.sourceName}</td>
                      <td className="px-4 py-3 font-mono text-xs text-fg-muted">{quotaLabel(row.quotaState)}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-fg-muted">
                        {dayjs(row.fetchedAt).tz(APP_TIMEZONE).format("YYYY-MM-DD HH:mm")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </PageFrame>
  );
}
