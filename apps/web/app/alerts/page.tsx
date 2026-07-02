import { fetchAlerts, fetchAlertCount } from "@/lib/api/alerts-query";
import { AlertList } from "@/components/alerts/alert-list";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AlertsPage({
  searchParams
}: {
  searchParams: PageSearchParams;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const filterType = first(params.type) as
    | "own"
    | "safety"
    | "policy"
    | "legal"
    | "risk"
    | undefined;
  const filterLevel = first(params.level) as "L1" | "L2" | "L3" | undefined;
  const rawRange = first(params.range);
  const filterRange = (
    rawRange === "7d" || rawRange === "all" ? rawRange : "24h"
  ) as "24h" | "7d" | "all";
  const rangeLabel =
    filterRange === "24h" ? "24H" : filterRange === "7d" ? "7D" : "ALL";
  const alertHref = (
    type: "own" | "safety" | "policy" | "legal" | "risk"
  ): string =>
    filterType === type
      ? `/alerts?range=${filterRange}`
      : `/alerts?type=${type}&range=${filterRange}`;

  const [{ items }, counts] = await Promise.all([
    fetchAlerts({
      type: filterType,
      level: filterLevel,
      limit: 50,
      range: filterRange
    }),
    fetchAlertCount(filterRange)
  ]);

  const total =
    counts.own + counts.safety + counts.policy + counts.legal + counts.risk;
  const p1Count = items.filter((i) => i.alertLevel === "L1").length;

  return (
    <main>
      <header className="grid grid-cols-[max-content_minmax(260px,360px)_minmax(0,1fr)] items-baseline gap-x-[18px] border-b border-hairline pad-fluid-x py-5 max-[1100px]:grid-cols-1 max-[1100px]:gap-y-1">
        <div className="font-mono text-[10px] font-medium uppercase tracking-[1.4px] text-fg-soft">
          / ALERTS · {rangeLabel}
        </div>
        <h1 className="m-0 display-fluid font-semibold tracking-tight text-fg">
          {total} 条告警 · {p1Count} 条 P1 需立即关注
        </h1>
        <div className="min-w-0">
          <p className="m-0 text-xs leading-6 text-fg-muted">
            五类告警共用通道：<b className="font-normal text-fg">自家公司</b>
            （C1 命中即告警，保证零漏报）·{" "}
            <b className="font-normal text-fg">竞品涉诉</b>（C2 +
            交易所涉诉公告）· <b className="font-normal text-fg">安全事故</b>
            （NER=事故 + D5 高风险）·{" "}
            <b className="font-normal text-fg">政策突发</b>（T1 政府 + D1
            高影响）· <b className="font-normal text-fg">竞品风险</b>（C2 +
            企业风险信源）。质量分仅表示条目可信度与信息价值，不作为 C1
            告警门槛。
          </p>
          <nav className="flex items-center gap-2 font-mono text-[11px] text-fg-soft mt-2 max-[1100px]:mt-0">
            {(["24h", "7d", "all"] as const).map((r) => (
              <a
                key={r}
                href={`/alerts?range=${r}${filterType ? `&type=${filterType}` : ""}${filterLevel ? `&level=${filterLevel}` : ""}`}
                className={`px-3 py-2 min-h-[36px] uppercase tracking-[1px] ${filterRange === r ? "bg-surface-deep text-white" : "hover:text-fg"}`}
              >
                {r === "24h" ? "24H" : r === "7d" ? "7D" : "ALL"}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <div className="pad-fluid-x py-5">
        <div className="mb-4 grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCell
            active={filterType === "own"}
            href={alertHref("own")}
            count={counts.own}
            label="自家公司 · C1"
            delta="含 P1 事故与中标动态"
            pip="bg-accent"
          />
          <SummaryCell
            active={filterType === "legal"}
            href={alertHref("legal")}
            count={counts.legal}
            label="竞品涉诉 · C2"
            delta="交易所法定披露"
            pip="bg-fg"
          />
          <SummaryCell
            active={filterType === "risk"}
            href={alertHref("risk")}
            count={counts.risk}
            label="竞品风险 · C2"
            delta="dataPro 风险库"
            pip="bg-orange-500"
          />
          <SummaryCell
            active={filterType === "safety"}
            href={alertHref("safety")}
            count={counts.safety}
            label="安全事故"
            delta="行业内 · 最近 6h"
            pip="bg-warn"
          />
          <SummaryCell
            active={filterType === "policy"}
            href={alertHref("policy")}
            count={counts.policy}
            label="政策突发"
            delta="能源局 / 工信部政策"
            pip="bg-sunshine-700"
          />
        </div>

        <AlertList items={items} filterRange={filterRange} />
      </div>
    </main>
  );
}

function SummaryCell({
  active,
  href,
  count,
  label,
  delta,
  pip
}: {
  active: boolean;
  href: string;
  count: number;
  label: string;
  delta: string;
  pip: string;
}): React.JSX.Element {
  return (
    <a
      href={href}
      className={`flex items-center gap-3.5 p-4 ${active ? "bg-surface-deep text-white" : "bg-surface text-fg hover:bg-bg-deep"}`}
    >
      <b className="min-w-10 font-display text-3xl font-normal leading-none tracking-[-0.6px] tabular-nums">
        {count}
      </b>
      <span className="min-w-0 flex-1">
        <span
          className={`flex items-center gap-2 font-mono text-[13px] uppercase tracking-[1.4px] ${active ? "text-sunshine-500" : "text-fg-soft"}`}
        >
          <i className={`h-1.5 w-1.5 rounded-full ${pip}`} />
          {label}
        </span>
        <span
          className={`block font-mono text-[12px] ${active ? "text-white/70" : "text-fg-muted"}`}
        >
          {delta}
        </span>
      </span>
    </a>
  );
}
