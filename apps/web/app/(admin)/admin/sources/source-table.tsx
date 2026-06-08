"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SourceForm } from "./source-form";

type FetcherType = "rss" | "html" | "playwright" | "quotes";

interface SourceRow {
  id: number;
  name: string;
  url: string;
  fetcherType: FetcherType;
  config: unknown;
  tier: "T1" | "T2" | "T3";
  category: string | null;
  enabled: boolean;
  lastOkAt: string | null;
  failCount: number;
}

type TierFilter = "ALL" | "T1" | "T2" | "T3" | "FAILED" | "DISABLED";

const TIER_CHIPS: { key: TierFilter; label: string }[] = [
  { key: "ALL", label: "全部" },
  { key: "T1", label: "T1" },
  { key: "T2", label: "T2" },
  { key: "T3", label: "T3" },
  { key: "FAILED", label: "仅失败" },
  { key: "DISABLED", label: "已停用" },
];

function tierColor(tier: "T1" | "T2" | "T3"): string {
  if (tier === "T1") return "bg-accent/15 text-accent";
  if (tier === "T2") return "bg-gold/15 text-gold";
  return "bg-fg-soft/15 text-fg-soft";
}

export function SourceTable(): React.JSX.Element {
  const [filter, setFilter] = useState<TierFilter>("ALL");
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [editingSource, setEditingSource] = useState<SourceRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    if (filter === "ALL") return rows;
    if (filter === "FAILED") return rows.filter((r) => r.failCount >= 3);
    if (filter === "DISABLED") return rows.filter((r) => !r.enabled);
    return rows.filter((r) => r.tier === filter);
  }, [rows, filter]);

  const totalCount = rows.length;
  const healthyCount = rows.filter((r) => r.enabled && r.failCount < 3).length;


  const kpis = [
    { label: "信源总数", value: totalCount },
    { label: "近 7 天成功率", value: totalCount > 0 ? `${Math.round((healthyCount / totalCount) * 100)}%` : "—" },
    { label: "近 24h 抓取量", value: "—" },
    { label: "失败信源", value: rows.filter((r) => r.failCount >= 3).length },
    { label: "下次抓取", value: "—" },
  ];

  const loadRows = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/sources", { cache: "no-store" });
      if (!response.ok) throw new Error("信源加载失败");
      const payload = (await response.json()) as { items: SourceRow[] };
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
      body: JSON.stringify({ enabled: !row.enabled }),
    });
    await loadRows();
  }

  async function deleteSource(row: SourceRow): Promise<void> {
    await fetch(`/api/sources/${row.id}`, { method: "DELETE" });
    await loadRows();
  }

  function beginEdit(row: SourceRow): void {
    setEditingSource(row);
    if (typeof document !== "undefined") {
      document.getElementById("source-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const handleSaved = useCallback(async () => {
    setEditingSource(null);
    await loadRows();
  }, [loadRows]);

  return (
    <div className="space-y-6">
      {/* ---- KPI strip ---- */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="border border-border bg-surface p-4 shadow-card"
          >
            <p className="font-mono text-[11px] uppercase tracking-widest text-fg-soft">
              {kpi.label}
            </p>
            <p className="mt-2 font-display text-2xl tracking-tightest text-fg">
              {kpi.value}
            </p>
          </div>
        ))}
      </section>

      {/* ---- Tier filter chips ---- */}
      <section className="flex flex-wrap gap-2">
        {TIER_CHIPS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilter(chip.key)}
            className={`rounded-none px-3 py-1.5 font-mono text-xs tracking-wide transition-colors ${
              filter === chip.key
                ? "bg-accent text-bg"
                : "border border-border bg-surface text-fg-muted hover:bg-bg-deep"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </section>

      {/* ---- 2-column: table + form ---- */}
      <section className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* left: source table */}
        <div className="border border-border bg-surface shadow-card">
          <div className="flex items-baseline justify-between border-b border-hairline px-6 py-4">
            <h3 className="font-display text-base font-semibold text-fg">
              信源列表
            </h3>
            <span className="font-mono text-[11px] text-fg-soft">
              {filteredRows.length} 条
            </span>
          </div>
          <div className="overflow-x-auto">
            {error ? (
              <p className="px-6 py-4 font-mono text-sm text-danger">{error}</p>
            ) : null}
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="px-6 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">ID</th>
                  <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">名称</th>
                  <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">Tier</th>
                  <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">URL</th>
                  <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">状态</th>
                  <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">最近成功</th>
                  <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">失败</th>
                  <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td className="px-6 py-8 text-fg-muted" colSpan={8}>
                      暂无匹配信源。
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr
                      key={row.id}
                      data-testid={`source-row-${row.id}`}
                      className={`transition-colors ${
                        editingSource?.id === row.id
                          ? "bg-accent/5 ring-1 ring-inset ring-accent"
                          : row.failCount >= 7
                            ? "bg-danger/5"
                            : row.failCount >= 3
                              ? "bg-warn/5"
                              : "hover:bg-bg-deep"
                      }`}
                    >
                      <td className="px-6 py-3 font-mono text-xs tabular-nums text-fg-soft">
                        {row.id}
                      </td>
                      <td className="px-3 py-3 font-medium text-fg">
                        {row.name}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-block rounded-none px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${tierColor(row.tier)}`}
                        >
                          {row.tier}
                        </span>
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-3 text-fg-muted">
                        {row.url}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`font-mono text-xs ${
                            row.enabled ? "text-ok" : "text-fg-soft"
                          }`}
                        >
                          {row.enabled ? "启用" : "停用"}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs tabular-nums text-fg-muted">
                        {row.lastOkAt ?? "—"}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs tabular-nums">
                        <span
                          className={
                            row.failCount >= 7
                              ? "text-danger"
                              : row.failCount >= 3
                                ? "text-warn"
                                : "text-fg-muted"
                          }
                        >
                          {row.failCount}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            className={`rounded-none px-2 py-1 font-mono text-[11px] hover:bg-accent/10 ${
                              editingSource?.id === row.id ? "bg-accent/10 text-accent" : "text-accent"
                            }`}
                            onClick={() => beginEdit(row)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className={`rounded-none px-2 py-1 font-mono text-[11px] hover:bg-bg-deep ${
                              row.enabled ? "text-warn" : "text-ok"
                            }`}
                            onClick={() => void toggleEnabled(row)}
                          >
                            {row.enabled ? "停用" : "启用"}
                          </button>
                          <button
                            type="button"
                            className="rounded-none px-2 py-1 font-mono text-[11px] text-danger hover:bg-danger/10"
                            onClick={() => void deleteSource(row)}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* right: add / edit source form (reused) */}
        <div
          id="source-form"
          className={`border bg-surface-warm p-6 shadow-card transition-colors ${
            editingSource ? "border-accent" : "border-border"
          }`}
        >
          <SourceForm
            key={editingSource?.id ?? "new"}
            editing={editingSource}
            onSaved={handleSaved}
            onCancelEdit={() => setEditingSource(null)}
          />
        </div>
      </section>
    </div>
  );
}
