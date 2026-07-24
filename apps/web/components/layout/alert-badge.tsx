"use client";

import { useEffect, useState } from "react";

const EMPTY = { own: 0, safety: 0, policy: 0, legal: 0, risk: 0 };

export function AlertBadge(): React.JSX.Element {
  const [count, setCount] = useState(EMPTY);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const response = await fetch("/api/alerts/count");
      if (!response.ok) return;
      const next = (await response.json()) as typeof EMPTY;
      if (!cancelled) setCount(next);
    }
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const total = count.own + count.safety + count.policy + count.legal + count.risk;
  if (total === 0) return <></>;

  return (
    <span className="font-mono text-[11px] bg-accent text-white px-1.5 py-[1px] tracking-[0.4px]">
      {total}
    </span>
  );
}
