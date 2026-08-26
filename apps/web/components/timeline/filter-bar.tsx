"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { CIRCLE_FILTERS, SOURCE_TIER_LABELS } from "@/components/timeline/meta";
import {
  replaceShallowSearch,
  useShallowSearchParams
} from "@/hooks/use-shallow-search-params";

const FILTER_KEYS = ["circle", "tier", "alertType"] as const;

const TIER_ITEMS = (["T1", "T2", "T3"] as const).map((tier) => ({
  value: tier,
  label: tier,
  title: SOURCE_TIER_LABELS[tier]
}));
const ALERTS = [
  { value: "own", label: "自家" },
  { value: "legal", label: "涉诉" },
  { value: "safety", label: "事故" },
  { value: "policy", label: "政策" },
  { value: "risk", label: "风险" }
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

/**
 * 筛选条。`shell`(760px) 以下默认折叠成一行开关——三组 chip 展开要占掉小屏近半屏，
 * 结果列表一条都看不到。760px 以上照旧常驻展开，开关本身隐藏。
 */
export function FilterBar(): React.JSX.Element {
  const pathname = usePathname();
  const params = useShallowSearchParams();
  const [open, setOpen] = useState(false);
  const activeCount = FILTER_KEYS.filter((key) => params.get(key)).length;

  const setParam = (key: string, value: string | null) => {
    replaceShallowSearch(pathname, updateParam(params, key, value));
  };

  return (
    <div className="border border-border bg-surface">
      <button
        aria-expanded={open}
        className="flex min-h-10 w-full items-center justify-between px-3 font-mono text-[11px] uppercase tracking-[1.2px] text-fg-muted shell:hidden"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        <span>筛选{activeCount > 0 ? ` · 已选 ${activeCount}` : ""}</span>
        <span aria-hidden>{open ? "收起 ▲" : "展开 ▼"}</span>
      </button>
      <div
        className={`${open ? "flex" : "hidden"} flex-col gap-3 px-3 pb-3 shell:flex shell:flex-row shell:flex-wrap shell:items-center shell:pt-3 sm:gap-2`}
      >
        <FilterGroup label="关注圈" values={CIRCLE_FILTERS} active={params.get("circle")} onPick={(value) => setParam("circle", value)} />
        <FilterGroup label="信源" values={TIER_ITEMS} active={params.get("tier")} onPick={(value) => setParam("tier", value)} />
        <FilterGroup label="告警" values={ALERTS} active={params.get("alertType")} onPick={(value) => setParam("alertType", value)} />
      </div>
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
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-2 shell:flex shell:items-center sm:gap-1">
      <span className="px-1 py-1 font-mono text-[10px] uppercase tracking-[1.2px] text-fg-soft sm:py-0">{label}</span>
      <div className="flex min-w-0 flex-wrap gap-1">
        {values.map((item) => (
          <button
            aria-pressed={active === item.value}
            className={`min-h-10 whitespace-nowrap border px-3 py-1 font-mono text-[11px] tracking-[0.4px] sm:min-h-8 sm:px-2.5 ${active === item.value ? "border-fg bg-fg text-white" : "border-border bg-bg text-fg-muted hover:bg-bg-deep"}`}
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
