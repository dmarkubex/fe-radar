"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DEFAULT_SOURCE_CATEGORIES, DEFAULT_SOURCE_CONFIGS, SMM_HQ_QUOTES_TEMPLATE } from "./source-default-configs";
import type { FetcherType } from "./source-default-configs";

export interface EditingSource {
  id: number;
  name: string;
  url: string;
  urlLocked: boolean;
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
  const isProtectedSeedUrl = isEdit && Boolean(editing?.urlLocked);
  const initialFetcherType = editing?.fetcherType ?? "rss";
  const [fetcherType, setFetcherType] = useState<FetcherType>(initialFetcherType);
  const [category, setCategory] = useState(editing?.category ?? DEFAULT_SOURCE_CATEGORIES[initialFetcherType] ?? "");
  const [config, setConfig] = useState(
    JSON.stringify(editing?.config ?? DEFAULT_SOURCE_CONFIGS.rss, null, 2),
  );
  const [error, setError] = useState<string | null>(null);

  function parseConfigRecord(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(config) as unknown;
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  const configError = parseConfigRecord() ? null : "Config 必须是有效的 JSON 对象。";

  function currentQuotesAdapter(): string {
    const parsed = parseConfigRecord();
    return typeof parsed?.["adapter"] === "string" ? parsed["adapter"] : "shfe";
  }

  function currentMetricKeys(): string {
    const parsed = parseConfigRecord();
    const keys = parsed?.["metric_keys"];
    return Array.isArray(keys) ? keys.filter((key) => typeof key === "string").join(",") : "";
  }

  function currentEndpoint(): string {
    const parsed = parseConfigRecord();
    return typeof parsed?.["endpoint"] === "string" ? parsed["endpoint"] : "";
  }

  function updateConfig(mutator: (draft: Record<string, unknown>) => void): void {
    const parsed = parseConfigRecord();
    if (!parsed) return;
    mutator(parsed);
    setConfig(JSON.stringify(parsed, null, 2));
  }

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
      const parsedConfig = parseConfigRecord();
      if (!parsedConfig) {
        setError("Config 必须是有效的 JSON 对象。");
        return;
      }
      const body = {
        name: String(formData.get("name") ?? ""),
        url: String(formData.get("url") ?? ""),
        tier: formData.get("tier"),
        fetcherType: formData.get("fetcherType"),
        category,
        config: parsedConfig,
      };
      const response = await fetch(
        isEdit ? `/api/sources/${editing!.id}` : "/api/sources",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        let detail = "保存失败，请检查字段和 config JSON。";
        try {
          const payload = (await response.json()) as { error?: { message?: string } };
          if (payload.error?.message) detail = payload.error.message;
        } catch {
          // keep generic fallback when body is not JSON
        }
        throw new Error(detail);
      }
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
          <label className="mb-1 block eyebrow">
            名称
          </label>
          <input className={FIELD} name="name" placeholder="信源名称" defaultValue={editing?.name ?? ""} />
        </div>
        <div>
          <label className="mb-1 block eyebrow">
            URL
          </label>
          <input
            className={FIELD}
            name="url"
            placeholder="https://"
            defaultValue={editing?.url ?? ""}
            readOnly={isProtectedSeedUrl}
          />
          {isProtectedSeedUrl ? (
            <p className="mt-1 font-mono text-[11px] text-fg-soft">
              <span className="mr-1 inline-block border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted">
                URL锁定
              </span>
              该信源 URL 由部署 seed migration 管理，不可在此修改。
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block eyebrow">
              Tier
            </label>
            <select className={FIELD} name="tier" defaultValue={editing?.tier ?? "T2"}>
              <option value="T1">T1</option>
              <option value="T2">T2</option>
              <option value="T3">T3</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block eyebrow">
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
          <label className="mb-1 block eyebrow">
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
                <label className="mb-1 block eyebrow">
                  Adapter
                </label>
                <select
                  className={FIELD}
                  data-testid="adapter-select"
                  onChange={(e) => {
                    updateConfig((parsed) => {
                      const nextAdapter = e.target.value;
                      parsed["adapter"] = nextAdapter;
                      if (nextAdapter === "smm-hq") {
                        Object.assign(parsed, SMM_HQ_QUOTES_TEMPLATE);
                        return;
                      }
                      if (nextAdapter !== "smm-hq") {
                        delete parsed["items"];
                      }
                    });
                  }}
                  value={currentQuotesAdapter()}
                >
                  <option value="shfe">shfe（上期所）</option>
                  <option value="gfex">gfex（广期所）</option>
                  <option value="lme">lme（LME）</option>
                  <option value="pboc">pboc（央行汇率）</option>
                  <option value="chinabond">chinabond（中国货币网）</option>
                  <option value="rsshub-extract">rsshub-extract</option>
                  <option value="smm-hq">smm-hq（上海有色网）</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block eyebrow">
                  Metric Keys（逗号分隔）
                </label>
                <input
                  className={FIELD}
                  data-testid="metric-keys-input"
                  placeholder="cu_main_close,cu_change_pct"
                  value={currentMetricKeys()}
                  onChange={(e) => {
                    const keys = e.target.value
                      .split(",")
                      .map((k) => k.trim())
                      .filter(Boolean);
                    updateConfig((parsed) => {
                      parsed["metric_keys"] = keys;
                    });
                  }}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block eyebrow">
                Endpoint URL
              </label>
              <input
                className={FIELD}
                placeholder="https://hq.smm.cn/h5/cu"
                value={currentEndpoint()}
                onChange={(e) => {
                  updateConfig((parsed) => {
                    parsed["endpoint"] = e.target.value;
                  });
                }}
              />
            </div>
          </div>
        ) : null}

        <div>
          <label className="mb-1 block eyebrow">
            Config JSON
          </label>
          <textarea
            aria-invalid={Boolean(configError)}
            className="min-h-32 w-full border border-border bg-bg p-3 font-mono text-xs text-fg focus:outline-none focus:border-accent"
            value={config}
            onChange={(e) => setConfig(e.target.value)}
          />
          {configError ? <p className="mt-1 text-xs text-danger" role="alert">{configError}</p> : null}
        </div>
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={Boolean(configError)}
        variant="accent"
      >
        {isEdit ? "保存修改" : "新建"}
      </Button>

      {error ? (
        <p className="font-mono text-xs text-danger">{error}</p>
      ) : null}
    </form>
  );
}
