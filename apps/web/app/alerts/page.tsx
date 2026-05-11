import { TimelineList } from "@/components/timeline/timeline-list";
import { fetchAlerts } from "@/lib/api/alerts-query";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

const TYPES = [
  { value: undefined, label: "全部" },
  { value: "own", label: "自家" },
  { value: "safety", label: "事故" },
  { value: "policy", label: "政策" }
] as const;

const LEVELS = [
  { value: undefined, label: "全部等级" },
  { value: "L1", label: "L1" },
  { value: "L2", label: "L2" },
  { value: "L3", label: "L3" }
] as const;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function href(type?: string, level?: string): string {
  const query = new URLSearchParams();
  if (type) {
    query.set("type", type);
  }
  if (level) {
    query.set("level", level);
  }
  const suffix = query.toString();
  return `/alerts${suffix ? `?${suffix}` : ""}`;
}

export default async function AlertsPage({ searchParams }: { searchParams: PageSearchParams }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const type = first(params.type) as "own" | "safety" | "policy" | undefined;
  const level = first(params.level) as "L1" | "L2" | "L3" | undefined;
  const initialData = await fetchAlerts({ type, level, limit: 50 });
  const endpoint = `/api/alerts${href(type, level).replace("/alerts", "")}`;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium text-zinc-500">三通道告警</p>
        <h1 className="text-2xl font-semibold text-zinc-950">告警</h1>
      </header>
      <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3">
        <div className="flex flex-wrap gap-2">
          {TYPES.map((item) => (
            <a className={`rounded-md px-3 py-1.5 text-sm font-medium ${type === item.value ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`} href={href(item.value, level)} key={item.label}>
              {item.label}
            </a>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {LEVELS.map((item) => (
            <a className={`rounded-md px-3 py-1.5 text-sm font-medium ${level === item.value ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`} href={href(type, item.value)} key={item.label}>
              {item.label}
            </a>
          ))}
        </div>
      </div>
      <TimelineList endpoint={endpoint} initialData={initialData} />
    </main>
  );
}
