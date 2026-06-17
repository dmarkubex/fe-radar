"use client";

import { useState } from "react";
import { DEFAULT_SOURCE_CATEGORIES, DEFAULT_SOURCE_CONFIGS } from "./source-default-configs";
import type { FetcherType } from "./source-default-configs";

export interface EditingSource {
  id: number;
  name: string;
  url: string;
  tier: "T1" | "T2" | "T3";
  category: string | null;
  fetcherType: FetcherType;
  config: unknown;
}

interface SourceFormProps {
  onSaved(): void;
  editing?: EditingSource | null;
  onCancelEdit?(): void;
}

const FIELD =
  "h-9 w-full border border-border bg-bg px-3 text-sm text-fg placeholder:text-fg-soft focus:outline-none focus:border-accent";

export function SourceForm({ onSaved, editing, onCancelEdit }: SourceFormProps): React.JSX.Element {
  const isEdit = Boolean(editing);
  const initialFetcherType = editing?.fetcherType ?? "rss";
  const [fetcherType, setFetcherType] = useState<FetcherType>(initialFetcherType);
  const [category, setCategory] = useState(editing?.category ?? DEFAULT_SOURCE_CATEGORIES[initialFetcherType] ?? "");
  const [config, setConfig] = useState(
    JSON.stringify(editing?.config ?? DEFAULT_SOURCE_CONFIGS.rss, null, 2),
  );
  const [error, setError] = useState<string | null>(null);

  function handleFetcherTypeChange(next: FetcherType): void {
    setFetcherType(next);
    setConfig(JSON.stringify(DEFAULT_SOURCE_CONFIGS[next], null, 2));
    if (!isEdit) {
      setCategory(DEFAULT_SOURCE_CATEGORIES[next] ?? "");
    }
  }

  async function submit(formData: FormData): Promise<void> {
    setError(null);
    try {
      const body = {
        name: String(formData.get("name") ?? ""),
        url: String(formData.get("url") ?? ""),
        tier: formData.get("tier"),
        fetcherType: formData.get("fetcherType"),
        category,
        config: JSON.parse(config) as unknown,
      };
      const response = await fetch(
        isEdit ? `/api/sources/${editing!.id}` : "/api/sources",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error("保存失败，请检查字段和 config JSON。");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    }
  }

  return (
    <form action={submit} className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-semibold text-fg">
          {isEdit ? `编辑信源 #${editing!.id}` : "新增信源"}
        </h3>
        {isEdit ? (
          <button
            type="button"
            className="rounded-none px-2 py-1 font-mono text-[11px] text-fg-muted hover:bg-bg-deep"
            onClick={() => onCancelEdit?.()}
          >
            取消编辑
          </button>
        ) : null}
      </div>
      <p className="font-mono text-[11px] text-fg-soft">
        {isEdit
          ? "修改字段后点击「保存修改」，将更新该信源的全部信息。"
          : "填写信源信息后点击「新建」提交。"}
      </p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
            名称
          </label>
          <input className={FIELD} name="name" placeholder="信源名称" defaultValue={editing?.name ?? ""} />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
            URL
          </label>
          <input className={FIELD} name="url" placeholder="https://" defaultValue={editing?.url ?? ""} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
              Tier
            </label>
            <select className={FIELD} name="tier" defaultValue={editing?.tier ?? "T2"}>
              <option value="T1">T1</option>
              <option value="T2">T2</option>
              <option value="T3">T3</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
              抓取类型
            </label>
            <select
              className={FIELD}
              name="fetcherType"
              value={fetcherType}
              onChange={(e) =>
                handleFetcherTypeChange(e.target.value as FetcherType)
              }
            >
              <option value="rss">RSS</option>
              <option value="html">HTML</option>
              <option value="playwright">Playwright</option>
              <option value="quotes">Quotes</option>
              <option value="announcement">Announcement (公告)</option>
              <option value="crawl">Crawl (Firecrawl)</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
            分类
          </label>
          <input
            className={FIELD}
            name="category"
            placeholder="分类"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
        </div>

        {fetcherType === "quotes" ? (
          <div className="space-y-3 border border-border p-3">
            <p className="font-mono text-[11px] text-fg-soft">
              {isEdit
                ? "数值精度字段请直接在下方 Config JSON 中编辑（adapter / metric_keys / endpoint）。"
                : "Quotes 信源新建后默认 disabled，需等 adapter 上线再启用。"}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
                  Adapter
                </label>
                <select
                  className={FIELD}
                  data-testid="adapter-select"
                  onChange={(e) => {
                    const parsed = JSON.parse(config) as Record<string, unknown>;
                    parsed["adapter"] = e.target.value;
                    setConfig(JSON.stringify(parsed, null, 2));
                  }}
                  defaultValue="shfe"
                >
                  <option value="shfe">shfe（上期所）</option>
                  <option value="gfex">gfex（广期所）</option>
                  <option value="lme">lme（LME）</option>
                  <option value="pboc">pboc（央行汇率）</option>
                  <option value="chinabond">chinabond（中国货币网）</option>
                  <option value="rsshub-extract">rsshub-extract</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
                  Metric Keys（逗号分隔）
                </label>
                <input
                  className={FIELD}
                  data-testid="metric-keys-input"
                  placeholder="cu_main_close,cu_change_pct"
                  onChange={(e) => {
                    const keys = e.target.value
                      .split(",")
                      .map((k) => k.trim())
                      .filter(Boolean);
                    const parsed = JSON.parse(config) as Record<string, unknown>;
                    parsed["metric_keys"] = keys;
                    setConfig(JSON.stringify(parsed, null, 2));
                  }}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
                Endpoint URL
              </label>
              <input
                className={FIELD}
                placeholder="http://www.shfe.com.cn/data/dailydata/kx/kx{YYYYMMDD}.dat"
                onChange={(e) => {
                  const parsed = JSON.parse(config) as Record<string, unknown>;
                  parsed["endpoint"] = e.target.value;
                  setConfig(JSON.stringify(parsed, null, 2));
                }}
              />
            </div>
          </div>
        ) : null}

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
        {isEdit ? "保存修改" : "新建"}
      </button>

      {error ? (
        <p className="font-mono text-xs text-danger">{error}</p>
      ) : null}
    </form>
  );
}
