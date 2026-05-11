"use client";

import { useMemo, useState } from "react";
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

const initialRows: SourceRow[] = [];

export function SourceTable(): React.JSX.Element {
  const [tier, setTier] = useState<"T1" | "T2" | "T3">("T1");
  const rows = useMemo(() => initialRows.filter((row) => row.tier === tier), [tier]);

  return (
    <div className="grid gap-4">
      <div className="flex gap-2">
        {(["T1", "T2", "T3"] as const).map((item) => (
          <Button key={item} variant={tier === item ? "default" : "outline"} onClick={() => setTier(item)}>
            {item}
          </Button>
        ))}
      </div>

      <SourceForm />

      <Card>
        <CardHeader>
          <CardTitle>{tier} 信源</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-zinc-500">
                  <th className="py-2 pr-4">名称</th>
                  <th className="py-2 pr-4">URL</th>
                  <th className="py-2 pr-4">状态</th>
                  <th className="py-2 pr-4">最近成功</th>
                  <th className="py-2 pr-4">失败次数</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="py-6 text-zinc-500" colSpan={5}>
                      暂无信源，使用上方表单新增。
                    </td>
                  </tr>
                ) : rows.map((row) => (
                  <tr key={row.id} className={row.failCount >= 7 ? "bg-red-50" : "border-b border-zinc-100"}>
                    <td className="py-2 pr-4 font-medium">{row.name}</td>
                    <td className="max-w-sm truncate py-2 pr-4">{row.url}</td>
                    <td className="py-2 pr-4">{row.enabled ? "启用" : "停用"}</td>
                    <td className="py-2 pr-4">{row.lastOkAt ?? "-"}</td>
                    <td className="py-2 pr-4">{row.failCount}</td>
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
