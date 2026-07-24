"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

interface EntityRow {
  id: number;
  type: string;
  canonicalName: string;
  aliases: string[];
  circle: string | null;
  weight: number;
}

const ENTITY_TYPES = [
  ["company", "公司"],
  ["product", "产品 / 型号"],
  ["policy", "政策 / 标准"],
  ["region", "地区"],
  ["money", "金额"],
  ["event_type", "事件类型"],
  ["project_type", "项目类型"]
] as const;

export function EntityTable(): React.JSX.Element {
  const [items, setItems] = useState<EntityRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<(typeof ENTITY_TYPES)[number][0]>("company");
  const [pending, setPending] = useState<"create" | "delete" | null>(null);
  const [deleting, setDeleting] = useState<EntityRow | null>(null);

  async function load(): Promise<void> {
    try {
      const response = await fetch("/api/entities");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? "实体加载失败");
      }
      const payload = await response.json() as { items?: EntityRow[] };
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setError(null);
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : "实体加载失败，请检查网络后重试");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(formData: FormData): Promise<void> {
    setError(null);
    const rawWeight = String(formData.get("weight") ?? "").trim();
    const weight = rawWeight === "" ? 1 : Number(rawWeight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
      setError("权重必须是 0–100 之间的数字。");
      return;
    }
    const aliases = String(formData.get("aliases") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const body = {
      type,
      canonicalName: String(formData.get("canonicalName") ?? ""),
      aliases,
      circle: type === "company" ? String(formData.get("circle") ?? "") || null : null,
      weight
    };
    setPending("create");
    try {
      const response = await fetch("/api/entities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(payload?.error?.message ?? "保存失败，请检查实体字段。");
        return;
      }
      await load();
    } catch {
      setError("保存失败，请检查网络后重试");
    } finally {
      setPending(null);
    }
  }

  async function remove(): Promise<void> {
    if (!deleting) return;
    setError(null);
    setPending("delete");
    try {
      const response = await fetch(`/api/entities/${deleting.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(payload?.error?.message ?? "删除实体失败");
        return;
      }
      setDeleting(null);
      await load();
    } catch {
      setError("删除实体失败，请检查网络后重试");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-4">
      <Dialog
        ariaLabel="确认删除实体"
        onClose={() => {
          setDeleting(null);
          setError(null);
        }}
        open={deleting !== null}
        panelClassName="w-full max-w-md border border-border bg-surface p-6 shadow-pop"
      >
        <h2 className="font-display text-lg font-semibold text-danger">确认删除实体</h2>
        <p className="mt-2 text-sm text-fg-muted">
          删除后相关实体配置将不可恢复。确认删除「{deleting?.canonicalName}」？
        </p>
        {error ? <p className="mt-3 text-sm text-danger" role="alert">{error}</p> : null}
        <div className="mt-5 flex gap-2">
          <Button disabled={pending === "delete"} onClick={() => void remove()} type="button">
            {pending === "delete" ? "删除中…" : "确认删除"}
          </Button>
          <Button disabled={pending === "delete"} onClick={() => setDeleting(null)} type="button" variant="outline">
            取消
          </Button>
        </div>
      </Dialog>
      <form action={submit} className="grid gap-3 rounded-none border border-border bg-surface p-4 md:grid-cols-5">
        <select
          className="h-10 rounded-none border border-border px-3"
          name="type"
          value={type}
          onChange={(event) => setType(event.target.value as (typeof ENTITY_TYPES)[number][0])}
        >
          {ENTITY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input className="h-10 rounded-none border border-border px-3" name="canonicalName" placeholder="标准名" required />
        <input className="h-10 rounded-none border border-border px-3" name="aliases" placeholder="别名，逗号分隔" />
        <select className="h-10 rounded-none border border-border px-3" disabled={type !== "company"} name="circle" defaultValue="">
          <option value="">无关注圈</option>
          <option value="C1">C1</option>
          <option value="C2">C2</option>
          <option value="C3">C3</option>
        </select>
        <input className="h-10 rounded-none border border-border px-3" name="weight" placeholder="权重" type="number" defaultValue="1" />
        <div className="md:col-span-5">
          <Button disabled={pending === "create"} type="submit">{pending === "create" ? "保存中…" : "新增实体"}</Button>
        </div>
        {error ? <p className="text-sm text-danger md:col-span-5">{error}</p> : null}
      </form>
      <div className="overflow-x-auto rounded-none border border-border bg-surface">
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
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => {
                      setError(null);
                      setDeleting(item);
                    }}
                  >
                    删除
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
