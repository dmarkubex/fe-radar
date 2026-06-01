"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface EntityRow {
  id: number;
  type: string;
  canonicalName: string;
  aliases: string[];
  circle: string | null;
  weight: number;
}

export function EntityTable(): React.JSX.Element {
  const [items, setItems] = useState<EntityRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    const response = await fetch("/api/entities");
    const payload = await response.json() as { items: EntityRow[] };
    setItems(payload.items);
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(formData: FormData): Promise<void> {
    setError(null);
    const aliases = String(formData.get("aliases") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const body = {
      type: String(formData.get("type") ?? ""),
      canonicalName: String(formData.get("canonicalName") ?? ""),
      aliases,
      circle: String(formData.get("circle") ?? "") || null,
      weight: Number(formData.get("weight") ?? 1)
    };
    const response = await fetch("/api/entities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      setError("保存失败，请检查 type/circle/别名。");
      return;
    }
    await load();
  }

  async function remove(id: number): Promise<void> {
    await fetch(`/api/entities/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="grid gap-4">
      <form action={submit} className="grid gap-3 rounded-none border border-border bg-surface p-4 md:grid-cols-5">
        <input className="h-10 rounded-none border border-border px-3" name="type" placeholder="type" />
        <input className="h-10 rounded-none border border-border px-3" name="canonicalName" placeholder="标准名" />
        <input className="h-10 rounded-none border border-border px-3" name="aliases" placeholder="别名，逗号分隔" />
        <select className="h-10 rounded-none border border-border px-3" name="circle" defaultValue="">
          <option value="">无关注圈</option>
          <option value="C1">C1</option>
          <option value="C2">C2</option>
          <option value="C3">C3</option>
        </select>
        <input className="h-10 rounded-none border border-border px-3" name="weight" placeholder="权重" type="number" defaultValue="1" />
        <div className="md:col-span-5">
          <Button type="submit">新增实体</Button>
        </div>
        {error ? <p className="text-sm text-danger md:col-span-5">{error}</p> : null}
      </form>
      <div className="overflow-hidden rounded-none border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-bg text-left text-[11px] font-mono uppercase text-fg-soft">
            <tr>
              <th className="p-3">类型</th>
              <th className="p-3">标准名</th>
              <th className="p-3">别名</th>
              <th className="p-3">关注圈</th>
              <th className="p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr className="border-t border-hairline" key={item.id}>
                <td className="p-3">{item.type}</td>
                <td className="p-3 font-medium text-fg">{item.canonicalName}</td>
                <td className="p-3 text-fg-muted">{item.aliases.join("，")}</td>
                <td className="p-3">{item.circle ?? "-"}</td>
                <td className="p-3">
                  <Button size="sm" variant="outline" type="button" onClick={() => void remove(item.id)}>删除</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
