import { fetchDashboardData } from "@/lib/api/dashboard-query";
import { listDisabledProxies } from "@/lib/api/proxy-admin";
import { ProxyPoolPanel } from "@/components/dashboard/proxy-pool-panel";

export const dynamic = "force-dynamic";

function toneClass(tone: string | undefined): string {
  if (tone === "critical") {
    return "border-red-200 bg-red-50 text-red-900";
  }
  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-zinc-200 bg-white text-zinc-950";
}

export default async function AdminDashboardPage(): Promise<React.JSX.Element> {
  const [data, disabledProxies] = await Promise.all([
    fetchDashboardData(),
    Promise.resolve(listDisabledProxies())
  ]);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header>
        <p className="text-sm font-medium text-zinc-500">后台</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-950">运行仪表盘</h1>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        {data.metrics.map((metric) => (
          <div className={`rounded-lg border p-4 ${toneClass(metric.tone)}`} key={metric.label}>
            <p className="text-sm text-zinc-500">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold">{metric.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className={`rounded-lg border p-5 ${toneClass(data.backlog.tone)}`}>
          <h2 className="text-base font-semibold">Backlog 健康</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt>pending_over_quota</dt><dd>{data.backlog.pending}</dd></div>
            <div className="flex justify-between"><dt>dropped_quota_expired</dt><dd>{data.backlog.droppedExpired}</dd></div>
            <div className="flex justify-between"><dt>超过 24h</dt><dd>{data.backlog.oldPending}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-zinc-500">阈值：超过 24h 的 priority backlog 比例 &gt; 30% 为警告，&gt; 50% 为紧急。</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-base font-semibold text-zinc-950">今日告警</h2>
          <dl className="mt-4 space-y-2 text-sm text-zinc-700">
            <div className="flex justify-between"><dt>own</dt><dd>{data.alertsToday.own}</dd></div>
            <div className="flex justify-between"><dt>safety</dt><dd>{data.alertsToday.safety}</dd></div>
            <div className="flex justify-between"><dt>policy</dt><dd>{data.alertsToday.policy}</dd></div>
          </dl>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-base font-semibold text-zinc-950">信源 / 代理池</h2>
          <dl className="mt-4 space-y-2 text-sm text-zinc-700">
            <div className="flex justify-between"><dt>信源总数</dt><dd>{data.sources.total}</dd></div>
            <div className="flex justify-between"><dt>停用信源</dt><dd>{data.sources.disabled}</dd></div>
            <div className="flex justify-between"><dt>连续失败 &gt;= 7</dt><dd>{data.sources.failedSevenDays}</dd></div>
          </dl>
          <ProxyPoolPanel initialItems={disabledProxies} />
        </div>
      </section>
    </main>
  );
}
