"use client";

import { useState } from "react";

const defaultConfig = JSON.stringify(
  { type: "rss", url: "https://news.bjx.com.cn/rss.xml" },
  null,
  2,
);

interface SourceFormProps {
  onSaved(): void;
}

const FIELD =
  "h-9 w-full border border-border bg-bg px-3 text-sm text-fg placeholder:text-fg-soft focus:outline-none focus:border-accent";

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
        config: JSON.parse(config) as unknown,
      };
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("保存失败，请检查字段和 config JSON。");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    }
  }

  return (
    <form action={submit} className="space-y-4">
      <h3 className="font-display text-base font-semibold text-fg">
        新增信源
      </h3>
      <p className="font-mono text-[11px] text-fg-soft">
        填写信源信息后点击「新建」提交。
      </p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
            名称
          </label>
          <input className={FIELD} name="name" placeholder="信源名称" />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
            URL
          </label>
          <input className={FIELD} name="url" placeholder="https://" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
              Tier
            </label>
            <select className={FIELD} name="tier" defaultValue="T2">
              <option value="T1">T1</option>
              <option value="T2">T2</option>
              <option value="T3">T3</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
              抓取类型
            </label>
            <select className={FIELD} name="fetcherType" defaultValue="rss">
              <option value="rss">RSS</option>
              <option value="html">HTML</option>
              <option value="playwright">Playwright</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
            分类
          </label>
          <input className={FIELD} name="category" placeholder="分类" />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
            Config JSON
          </label>
          <textarea
            className="min-h-32 w-full border border-border bg-bg p-3 font-mono text-xs text-fg focus:outline-none focus:border-accent"
            value={config}
            onChange={(e) => setConfig(e.target.value)}
          />
        </div>
      </div>

      <button
        type="submit"
        className="w-full border border-accent bg-accent py-2 font-mono text-xs uppercase tracking-wide text-bg transition-colors hover:bg-accent/90"
      >
        新建
      </button>

      {error ? (
        <p className="font-mono text-xs text-danger">{error}</p>
      ) : null}
    </form>
  );
}
