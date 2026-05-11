"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ScoringConfigEditor({ initialValue }: { initialValue: unknown }): React.JSX.Element {
  const [value, setValue] = useState(JSON.stringify(initialValue, null, 2));
  const [status, setStatus] = useState<string>("");

  async function save(): Promise<void> {
    setStatus("保存中");
    const response = await fetch("/api/scoring-config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: value
    });
    setStatus(response.ok ? "已保存" : "保存失败：请检查权重和是否为 1.00");
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5">
      <textarea className="min-h-[520px] w-full rounded-md border border-zinc-200 p-3 font-mono text-sm" value={value} onChange={(event) => setValue(event.target.value)} />
      <div className="mt-4 flex items-center gap-3">
        <Button type="button" onClick={() => void save()}>保存配置</Button>
        <span className="text-sm text-zinc-500">{status}</span>
      </div>
    </section>
  );
}
