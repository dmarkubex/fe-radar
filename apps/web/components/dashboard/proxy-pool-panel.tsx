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
  const [error, setError] = useState<string | null>(null);

  async function reenable(id: string): Promise<void> {
    setPendingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/proxy/${encodeURIComponent(id)}/re-enable`, { method: "POST" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(payload?.error?.message ?? "代理重启失败，请稍后重试");
        return;
      }
      setItems((current) => current.filter((item) => item.id !== id));
    } catch {
      setError("代理重启失败，请检查网络后重试");
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="mt-4 space-y-2">
        {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
        <p className="border border-border bg-bg px-3 py-2 text-sm text-fg-muted">暂无停用代理</p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
      <div className="overflow-x-auto border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg text-xs uppercase text-fg-soft">
            <tr>
              <th className="px-3 py-2 font-medium">host</th>
              <th className="px-3 py-2 font-medium">原因</th>
              <th className="px-3 py-2 font-medium">停用时间</th>
              <th className="px-3 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2 text-fg">{item.host}:{item.port}</td>
                <td className="px-3 py-2 text-fg-muted">{item.reason} · {item.failCount}</td>
                <td className="px-3 py-2 text-fg-muted">{item.disabledAt ?? "-"}</td>
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
    </div>
  );
}
