"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CIRCLE_FILTERS, SOURCE_TIER_LABELS } from "@/components/timeline/meta";

const TIER_ITEMS = (["T1", "T2", "T3"] as const).map((tier) => ({
  value: tier,
  label: tier,
  title: SOURCE_TIER_LABELS[tier]
}));
const ALERTS = [
  { value: "own", label: "自家" },
  { value: "legal", label: "涉诉" },
  { value: "safety", label: "事故" },
  { value: "policy", label: "政策" }
];

function updateParam(params: URLSearchParams, key: string, value: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) {
    next.set(key, value);
  } else {
    next.delete(key);
  }
  next.delete("cursor");
  return next;
}

export function FilterBar(): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = (key: string, value: string | null) => {
    router.replace(`${pathname}?${updateParam(params, key, value).toString()}`);
  };

  return (
    <div className="flex flex-col gap-3 border border-border bg-surface p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
      <FilterGroup label="关注圈" values={CIRCLE_FILTERS} active={params.get("circle")} onPick={(value) => setParam("circle", value)} />
      <FilterGroup label="信源" values={TIER_ITEMS} active={params.get("tier")} onPick={(value) => setParam("tier", value)} />
      <FilterGroup label="告警" values={ALERTS} active={params.get("alertType")} onPick={(value) => setParam("alertType", value)} />
    </div>
  );
}

function FilterGroup({
  label,
  values,
  active,
  onPick
}: {
  label: string;
  values: Array<{ value: string; label: string; title?: string }>;
  active: string | null;
  onPick: (value: string | null) => void;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-2 sm:flex sm:items-center sm:gap-1">
      <span className="px-1 py-1 font-mono text-[10px] uppercase tracking-[1.2px] text-fg-soft sm:py-0">{label}</span>
      <div className="flex min-w-0 flex-wrap gap-1">
        {values.map((item) => (
          <button
            aria-pressed={active === item.value}
            className={`min-h-8 whitespace-nowrap border px-2.5 py-1 font-mono text-[11px] tracking-[0.4px] ${active === item.value ? "border-fg bg-fg text-white" : "border-border bg-bg text-fg-muted hover:bg-bg-deep"}`}
            key={item.value}
            title={item.title}
            type="button"
            onClick={() => onPick(active === item.value ? null : item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
