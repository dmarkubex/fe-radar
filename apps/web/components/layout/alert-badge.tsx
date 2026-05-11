"use client";

import { useEffect, useState } from "react";

const EMPTY = { own: 0, safety: 0, policy: 0 };

export function AlertBadge(): React.JSX.Element {
  const [count, setCount] = useState(EMPTY);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const response = await fetch("/api/alerts/count");
      if (!response.ok) {
        return;
      }
      const next = (await response.json()) as typeof EMPTY;
      if (!cancelled) {
        setCount(next);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="flex items-center gap-1 text-xs">
      <Badge label="own" value={count.own} className="bg-red-50 text-red-700" />
      <Badge label="safety" value={count.safety} className="bg-zinc-100 text-zinc-700" />
      <Badge label="policy" value={count.policy} className="bg-blue-50 text-blue-700" />
    </div>
  );
}

function Badge({ label, value, className }: { label: string; value: number; className: string }): React.JSX.Element {
  return <span className={`rounded-md px-2 py-1 font-medium ${className}`}>{label} {value}</span>;
}
