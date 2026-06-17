"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CATEGORY_TABS } from "@/components/timeline/meta";

export type CuratedCategoryStat = {
  value: string;
  label: string;
  icon: string;
  count: number;
  topScore: number | null;
};

export function CuratedCategoryNav({
  categories,
  activeCategory,
}: {
  categories: readonly CuratedCategoryStat[];
  activeCategory: string;
}): React.JSX.Element {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticCategory, setOptimisticCategory] = useState<string | null>(null);

  const displayedCategory = optimisticCategory ?? activeCategory;

  useEffect(() => {
    setOptimisticCategory(null);
  }, [activeCategory]);

  const navigate = (value: string) => {
    if (value === activeCategory) return;
    setOptimisticCategory(value);
    startTransition(() => {
      router.replace(`/curated?category=${encodeURIComponent(value)}`, { scroll: false });
    });
  };

  return (
    <>
      <div
        className={`category-strip grid grid-cols-5 gap-0 border border-border-strong transition-opacity ${
          isPending ? "opacity-90" : ""
        }`}
        aria-busy={isPending}
      >
        {categories.map((cat) => {
          const isActive = displayedCategory === cat.value;
          return (
            <button
              key={cat.value}
              type="button"
              onClick={() => navigate(cat.value)}
              className={`group flex w-full flex-col items-center gap-0.5 border-r border-hairline px-3 py-2.5 text-left last:border-r-0 transition-colors ${
                isActive ? "bg-surface-deep text-fg-on-dark" : "bg-surface text-fg hover:bg-surface-warm"
              }`}
            >
              <span className={`font-mono text-sm ${isActive ? "text-fg-on-dark" : "text-accent"}`}>{cat.icon}</span>
              <span
                className={`text-center text-[13px] font-medium uppercase tracking-[1px] ${
                  isActive ? "text-fg-on-dark" : "text-fg-soft"
                }`}
              >
                {cat.label}
              </span>
              <span className={`font-mono text-3xl font-semibold tabular-nums ${isActive ? "text-fg-on-dark" : "text-fg"}`}>
                {cat.count}
              </span>
              {cat.topScore !== null ? (
                <span className={`font-mono text-[12px] ${isActive ? "text-fg-on-dark/70" : "text-fg-muted"}`}>
                  ▲ {cat.topScore.toFixed(1)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="tab-strip flex gap-0 border-b border-border-strong">
        {CATEGORY_TABS.map((tab) => {
          const isActive = displayedCategory === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => navigate(tab.value)}
              className={`border-b-2 px-5 py-2.5 text-sm font-medium transition-colors ${
                isActive ? "border-accent text-accent" : "border-transparent text-fg-muted hover:text-fg"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </>
  );
}
