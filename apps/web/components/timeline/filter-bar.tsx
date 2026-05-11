"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CIRCLE_FILTERS } from "@/components/timeline/meta";

const TIERS = ["T1", "T2", "T3"];
const ALERTS = [
  { value: "own", label: "自家" },
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
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white p-3">
      <FilterGroup label="关注圈" values={CIRCLE_FILTERS} active={params.get("circle")} onPick={(value) => setParam("circle", value)} />
      <FilterGroup label="信源" values={TIERS.map((value) => ({ value, label: value }))} active={params.get("tier")} onPick={(value) => setParam("tier", value)} />
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
  values: Array<{ value: string; label: string }>;
  active: string | null;
  onPick: (value: string | null) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <span className="px-1 text-xs font-medium text-zinc-500">{label}</span>
      {values.map((item) => (
        <button
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${active === item.value ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}
          key={item.value}
          type="button"
          onClick={() => onPick(active === item.value ? null : item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
