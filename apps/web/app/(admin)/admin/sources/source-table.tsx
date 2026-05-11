"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SourceForm } from "./source-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SourceRow {
  id: number;
  name: string;
  url: string;
  tier: "T1" | "T2" | "T3";
  category: string | null;
  enabled: boolean;
  lastOkAt: string | null;
  failCount: number;
}

export function SourceTable(): React.JSX.Element {
  const [tier, setTier] = useState<"T1" | "T2" | "T3">("T1");
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const filteredRows = useMemo(() => rows.filter((row) => row.tier === tier), [rows, tier]);

  const loadRows = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/sources", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("信源加载失败");
      }
      const payload = await response.json() as { items: SourceRow[] };
      setRows(payload.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "信源加载失败");
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  async function toggleEnabled(row: SourceRow): Promise<void> {
    await fetch(`/api/sources/${row.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !row.enabled })
    });
    await loadRows();
  }

  async function deleteSource(row: SourceRow): Promise<void> {
    await fetch(`/api/sources/${row.id}`, { method: "DELETE" });
    await loadRows();
  }

  async function saveName(row: SourceRow): Promise<void> {
    await fetch(`/api/sources/${row.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: editingName })
    });
    setEditingId(null);
    setEditingName("");
    await loadRows();
  }

  return (
    <div className="grid gap-4">
      <div className="flex gap-2">
        {(["T1", "T2", "T3"] as const).map((item) => (
          <Button key={item} variant={tier === item ? "default" : "outline"} onClick={() => setTier(item)}>
            {item}
          </Button>
        ))}
      </div>

      <SourceForm onSaved={loadRows} />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>{tier} 信源</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-zinc-500">
                  <th className="py-2 pr-4">ID</th>
                  <th className="py-2 pr-4">名称</th>
                  <th className="py-2 pr-4">URL</th>
                  <th className="py-2 pr-4">状态</th>
                  <th className="py-2 pr-4">最近成功</th>
                  <th className="py-2 pr-4">失败次数</th>
                  <th className="py-2 pr-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td className="py-6 text-zinc-500" colSpan={7}>
                      暂无信源，使用上方表单新增。
                    </td>
                  </tr>
                ) : filteredRows.map((row) => (
                  <tr key={row.id} data-testid={`source-row-${row.id}`} className={row.failCount >= 7 ? "bg-red-50" : "border-b border-zinc-100"}>
                    <td className="py-2 pr-4 text-zinc-500">{row.id}</td>
                    <td className="py-2 pr-4 font-medium">
                      {editingId === row.id ? (
                        <input
                          aria-label="信源名称"
                          className="h-9 rounded-md border border-zinc-200 px-2"
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                        />
                      ) : row.name}
                    </td>
                    <td className="max-w-sm truncate py-2 pr-4">{row.url}</td>
                    <td className="py-2 pr-4">{row.enabled ? "启用" : "停用"}</td>
                    <td className="py-2 pr-4">{row.lastOkAt ?? "-"}</td>
                    <td className="py-2 pr-4">{row.failCount}</td>
                    <td className="flex gap-2 py-2 pr-4">
                      {editingId === row.id ? (
                        <>
                          <Button type="button" variant="outline" onClick={() => void saveName(row)}>
                            保存编辑
                          </Button>
                          <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
                            取消
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button type="button" variant="outline" onClick={() => {
                            setEditingId(row.id);
                            setEditingName(row.name);
                          }}>
                            编辑
                          </Button>
                          <Button type="button" variant="outline" onClick={() => void toggleEnabled(row)}>
                            {row.enabled ? "停用" : "启用"}
                          </Button>
                          <Button type="button" variant="outline" onClick={() => void deleteSource(row)}>
                            删除
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
