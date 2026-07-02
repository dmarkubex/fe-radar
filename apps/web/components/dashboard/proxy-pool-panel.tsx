"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface DisabledProxy {
  id: string;
  host: string;
  port: string;
  reason: string;
  disabledAt: string | null;
  failCount: number;
}

interface ProxyPoolPanelProps {
  initialItems: DisabledProxy[];
}

export function ProxyPoolPanel({ initialItems }: ProxyPoolPanelProps): React.JSX.Element {
  const [items, setItems] = useState(initialItems);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function reenable(id: string): Promise<void> {
    setPendingId(id);
    try {
      const response = await fetch(`/api/admin/proxy/${encodeURIComponent(id)}/re-enable`, { method: "POST" });
      if (!response.ok) {
        return;
      }
      setItems((current) => current.filter((item) => item.id !== id));
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0) {
    return <p className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">暂无停用代理</p>;
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-zinc-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-3 py-2 font-medium">host</th>
            <th className="px-3 py-2 font-medium">原因</th>
            <th className="px-3 py-2 font-medium">停用时间</th>
            <th className="px-3 py-2 font-medium">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {items.map((item) => (
            <tr key={item.id}>
              <td className="px-3 py-2 text-zinc-950">{item.host}:{item.port}</td>
              <td className="px-3 py-2 text-zinc-700">{item.reason} · {item.failCount}</td>
              <td className="px-3 py-2 text-zinc-700">{item.disabledAt ?? "-"}</td>
              <td className="px-3 py-2">
                <Button size="sm" variant="outline" type="button" disabled={pendingId === item.id} onClick={() => void reenable(item.id)}>
                  重启
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
