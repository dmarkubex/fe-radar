import { and, desc, eq } from "drizzle-orm";
import { getDb, itemAnalysis, items, sources } from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header>
        <p className="text-sm font-medium text-zinc-500">后台</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-950">Backlog 抽查</h1>
      </header>
      <div className="flex gap-2">
        <a className={`rounded-md px-3 py-1.5 text-sm ${!state ? "bg-zinc-950 text-white" : "bg-zinc-100"}`} href="/admin/backlog">全部</a>
        <a className={`rounded-md px-3 py-1.5 text-sm ${state === "pending_over_quota" ? "bg-zinc-950 text-white" : "bg-zinc-100"}`} href="/admin/backlog?state=pending_over_quota">Pending</a>
        <a className={`rounded-md px-3 py-1.5 text-sm ${state === "dropped_quota_expired" ? "bg-zinc-950 text-white" : "bg-zinc-100"}`} href="/admin/backlog?state=dropped_quota_expired">Dropped</a>
      </div>
      <section className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-500">
            <tr>
              <th className="p-3">标题</th>
              <th className="p-3">信源</th>
              <th className="p-3">状态</th>
              <th className="p-3">抓取时间</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-t border-zinc-100" key={row.id}>
                <td className="p-3 font-medium text-zinc-950">{row.title}</td>
                <td className="p-3">{row.sourceName}</td>
                <td className="p-3">{row.quotaState}</td>
                <td className="p-3">{dayjs(row.fetchedAt).tz(APP_TIMEZONE).format("YYYY-MM-DD HH:mm")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
