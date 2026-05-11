"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const defaultConfig = JSON.stringify({ type: "rss", url: "https://news.bjx.com.cn/rss.xml" }, null, 2);

interface SourceFormProps {
  onSaved(): void;
}

export function SourceForm({ onSaved }: SourceFormProps): React.JSX.Element {
  const [config, setConfig] = useState(defaultConfig);
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData): Promise<void> {
    setError(null);
    try {
      const body = {
        name: String(formData.get("name") ?? ""),
        url: String(formData.get("url") ?? ""),
        tier: formData.get("tier"),
        fetcherType: formData.get("fetcherType"),
        category: String(formData.get("category") ?? ""),
        config: JSON.parse(config) as unknown
      };

      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        throw new Error("保存失败，请检查字段和 config JSON。");
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>新增信源</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={submit} className="grid gap-3 md:grid-cols-2">
          <input className="h-10 rounded-md border border-zinc-200 px-3" name="name" placeholder="名称" />
          <input className="h-10 rounded-md border border-zinc-200 px-3" name="url" placeholder="URL" />
          <select className="h-10 rounded-md border border-zinc-200 px-3" name="tier" defaultValue="T2">
            <option value="T1">T1</option>
            <option value="T2">T2</option>
            <option value="T3">T3</option>
          </select>
          <select className="h-10 rounded-md border border-zinc-200 px-3" name="fetcherType" defaultValue="rss">
            <option value="rss">RSS</option>
            <option value="html">HTML</option>
            <option value="playwright">Playwright</option>
          </select>
          <input className="h-10 rounded-md border border-zinc-200 px-3 md:col-span-2" name="category" placeholder="分类" />
          <textarea className="min-h-36 rounded-md border border-zinc-200 p-3 font-mono text-sm md:col-span-2" value={config} onChange={(event) => setConfig(event.target.value)} />
          <div className="md:col-span-2">
            <Button type="submit">新建</Button>
          </div>
          {error ? <p className="text-sm text-red-600 md:col-span-2">{error}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
