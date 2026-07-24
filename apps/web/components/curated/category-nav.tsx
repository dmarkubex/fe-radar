"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
    <div
      className={`category-strip flex overflow-x-auto border border-border-strong transition-opacity [-ms-overflow-style:none] [scrollbar-width:none] shell:grid shell:grid-cols-5 shell:overflow-visible [&::-webkit-scrollbar]:hidden ${
        isPending ? "opacity-90" : ""
      }`}
      aria-busy={isPending}
      aria-label="精选分类"
    >
      {categories.map((cat) => {
        const isActive = displayedCategory === cat.value;
        return (
          <button
            key={cat.value}
            type="button"
            onClick={() => navigate(cat.value)}
            className={`group flex min-h-11 min-w-[112px] flex-col items-center gap-0.5 border-r border-hairline px-3 py-2.5 text-left last:border-r-0 transition-colors shell:min-w-0 ${
              isActive ? "bg-surface-deep text-fg-on-dark" : "bg-surface text-fg hover:bg-surface-warm"
            }`}
          >
            <span className={`font-mono text-sm ${isActive ? "text-fg-on-dark" : "text-accent"}`}>{cat.icon}</span>
            <span
              className={`text-center text-[11px] font-medium uppercase tracking-[1px] sm:text-[13px] ${
                isActive ? "text-fg-on-dark" : "text-fg-soft"
              }`}
            >
              {cat.label}
            </span>
            <span className={`font-mono text-xl font-semibold tabular-nums sm:text-2xl md:text-3xl ${isActive ? "text-fg-on-dark" : "text-fg"}`}>
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
  );
}
