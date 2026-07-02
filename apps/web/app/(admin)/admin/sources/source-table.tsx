"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";
import { SourceForm } from "./source-form";

type FetcherType = "rss" | "html" | "playwright" | "quotes" | "announcement" | "crawl";

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

// ---- health wire types (mirror /api/admin/source-health response) ----

type SourceHealth = "healthy" | "stale" | "failing" | "disabled";

interface HealthRow {
  id: number;
  health: SourceHealth;
  staleHours: number | null;
  nextFetchIso: string | null;
  lastError: string | null;
  lastErrorAtIso: string | null;
}

interface HealthSummary {
  healthy: number;
  stale: number;
  failing: number;
  disabled: number;
  fetched24h: number;
}

interface HealthPayload {
  summary: HealthSummary;
  sources: HealthRow[];
}

const HEALTH_BADGE: Record<SourceHealth, string> = {
  healthy: "text-ok",
  stale: "text-warn",
  failing: "text-danger",
  disabled: "text-fg-soft"
};

const HEALTH_LABEL: Record<SourceHealth, string> = {
  healthy: "正常",
  stale: "陈旧",
  failing: "失败",
  disabled: "停用"
};

// Manual relative-time formatter: the shared dayjs build only extends utc +
// timezone (no relativeTime plugin), so we compute the diff by hand. Handles
// both past ("N 分钟前") and future ("N 分钟后") timestamps. Copied locally
// from components/worker/worker-monitor.tsx because that file is a sibling
// client component and cannot be imported from this route.
function relativeFromNow(iso: string | null): string {
  if (!iso) return "—";
  const t = dayjs(iso);
  if (!t.isValid()) return "—";
  const diffSec = t.tz(APP_TIMEZONE).diff(dayjs().tz(APP_TIMEZONE), "second");
  const suffix = diffSec >= 0 ? "后" : "前";
  const abs = Math.abs(diffSec);
  if (abs < 60) return `${abs} 秒${suffix}`;
  const mins = Math.round(abs / 60);
  if (mins < 60) return `${mins} 分钟${suffix}`;
  const hours = Math.round(abs / 3600);
  if (hours < 24) return `${hours} 小时${suffix}`;
  const days = Math.round(abs / 86400);
  return `${days} 天${suffix}`;
}

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
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");

  const filteredRows = useMemo(() => {
    let result = rows;
    if (filter === "FAILED") result = result.filter((r) => r.failCount >= 3);
    else if (filter === "DISABLED") result = result.filter((r) => !r.enabled);
    else if (filter !== "ALL") result = result.filter((r) => r.tier === filter);

    if (search.trim()) {
      const kw = search.trim().toLowerCase();
      result = result.filter((r) => r.name.toLowerCase().includes(kw));
    }
    return result;
  }, [rows, filter, search]);

  const totalCount = rows.length;
  const failedCount = rows.filter((r) => r.failCount >= 3).length;

  // 健康率: healthy / (total - disabled)，分母 ≤ 0 显示 "—"
  const disabledSummary = health?.summary.disabled ?? 0;
  const healthySummary = health?.summary.healthy ?? 0;
  const healthDenominator = totalCount - disabledSummary;
  const healthRateStr =
    health && healthDenominator > 0
      ? `${Math.round((healthySummary / healthDenominator) * 100)}%`
      : "—";

  // 下次抓取: 所有 nextFetchIso 中最小的（最近）一个
  const nextFetchIso = health
    ? health.sources
        .map((s) => s.nextFetchIso)
        .filter((iso): iso is string => iso !== null)
        .sort()[0] ?? null
    : null;

  const kpis = [
    { label: "信源总数", value: totalCount },
    { label: "当前健康率", value: healthRateStr },
    { label: "近 24h 抓取量", value: health ? health.summary.fetched24h : "—" },
    { label: "失败信源", value: failedCount },
    { label: "下次抓取", value: relativeFromNow(nextFetchIso) }
  ];

  // merge: health.sources → Map<id, HealthRow>，表格渲染时按 id lookup
  const healthMap = useMemo(() => {
    if (!health) return new Map<number, HealthRow>();
    return new Map(health.sources.map((h) => [h.id, h]));
  }, [health]);

  const loadRows = useCallback(async () => {
    setError(null);
    setHealthError(null);
    // Promise.allSettled: 双 fetch 并行，单侧失败不白屏，沿用 per-panel error 模式
    const [sourcesResult, healthResult] = await Promise.allSettled([
      fetch("/api/sources", { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("信源加载失败");
        return r.json() as Promise<{ items: SourceRow[] }>;
      }),
      fetch("/api/admin/source-health", { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("健康数据加载失败");
        return r.json() as Promise<HealthPayload>;
      })
    ]);

    if (sourcesResult.status === "fulfilled") {
      setRows(sourcesResult.value.items);
    } else {
      setError(
        sourcesResult.reason instanceof Error ? sourcesResult.reason.message : "信源加载失败"
      );
    }

    if (healthResult.status === "fulfilled") {
      setHealth(healthResult.value);
    } else {
      setHealthError(
        healthResult.reason instanceof Error
          ? healthResult.reason.message
          : "健康数据加载失败"
      );
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
            className={`min-h-10 rounded-none px-3 py-1.5 font-mono text-xs tracking-wide transition-colors ${
              filter === chip.key
                ? "bg-accent text-bg"
                : "border border-border bg-surface text-fg-muted hover:bg-bg-deep"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </section>

      {/* ---- name search ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="搜索信源名称…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-h-10 w-full border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg placeholder:text-fg-soft focus:border-accent focus:outline-none sm:w-64"
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="min-h-10 px-2 font-mono text-xs text-fg-muted hover:text-fg"
          >
            清除
          </button>
        ) : null}
      </div>

      {/* ---- 2-column: table + form ---- */}
      <section className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* left: source table */}
        <div className="min-w-0 border border-border bg-surface shadow-card">
          <div className="flex items-baseline justify-between border-b border-hairline px-4 py-4 sm:px-6">
            <h3 className="font-display text-base font-semibold text-fg">
              信源列表
            </h3>
            <span className="font-mono text-[11px] text-fg-soft">
              {filteredRows.length} 条
            </span>
          </div>
          {/* health 内联错误：不全屏报错 */}
          {healthError ? (
            <p className="px-6 py-2 font-mono text-[11px] text-warn">
              健康数据暂不可用: {healthError}
            </p>
          ) : null}
          {error ? (
            <p className="px-4 py-4 font-mono text-sm text-danger sm:px-6">{error}</p>
          ) : null}
          <div className="divide-y divide-hairline md:hidden">
            {filteredRows.length === 0 ? (
              <div className="px-4 py-8 text-sm text-fg-muted">
                暂无匹配信源。
              </div>
            ) : (
              filteredRows.map((row) => {
                const healthRow = healthMap.get(row.id);
                return (
                  <article
                    key={row.id}
                    data-testid={`source-card-${row.id}`}
                    className={`px-4 py-4 ${
                      editingSource?.id === row.id
                        ? "bg-accent/5 ring-1 ring-inset ring-accent"
                        : row.failCount >= 7
                          ? "bg-danger/5"
                          : row.failCount >= 3
                            ? "bg-warn/5"
                            : "bg-surface"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-fg">
                          {row.name}
                        </div>
                        <div className="mt-1 break-all font-mono text-[11px] leading-5 text-fg-muted">
                          {row.url}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${tierColor(row.tier)}`}
                      >
                        {row.tier}
                      </span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="font-mono text-[10px] uppercase tracking-widest text-fg-soft">
                          状态
                        </dt>
                        <dd className={row.enabled ? "text-ok" : "text-fg-soft"}>
                          {row.enabled ? "启用" : "停用"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-mono text-[10px] uppercase tracking-widest text-fg-soft">
                          健康
                        </dt>
                        <dd className={healthRow ? HEALTH_BADGE[healthRow.health] : "text-fg-soft"}>
                          {healthRow ? HEALTH_LABEL[healthRow.health] : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-mono text-[10px] uppercase tracking-widest text-fg-soft">
                          最近成功
                        </dt>
                        <dd className="font-mono text-fg-muted">
                          {row.lastOkAt ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-mono text-[10px] uppercase tracking-widest text-fg-soft">
                          失败
                        </dt>
                        <dd
                          className={
                            row.failCount >= 7
                              ? "text-danger"
                              : row.failCount >= 3
                                ? "text-warn"
                                : "text-fg-muted"
                          }
                        >
                          {row.failCount}
                        </dd>
                      </div>
                    </dl>
                    {healthRow?.lastError ? (
                      <div className="mt-3 border-l-2 border-danger/40 bg-danger/5 px-3 py-2">
                        <div className="font-mono text-[10px] uppercase tracking-widest text-danger">
                          最近错误
                        </div>
                        <div className="mt-1 break-all font-mono text-[11px] leading-relaxed text-fg-muted">
                          {healthRow.lastError}
                          {healthRow.lastErrorAtIso ? (
                            <span className="ml-2 text-fg-soft">
                              · {relativeFromNow(healthRow.lastErrorAtIso)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        className={`min-h-10 border border-border px-2 font-mono text-[11px] ${
                          editingSource?.id === row.id ? "bg-accent/10 text-accent" : "text-accent"
                        }`}
                        onClick={() => beginEdit(row)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className={`min-h-10 border border-border px-2 font-mono text-[11px] ${
                          row.enabled ? "text-warn" : "text-ok"
                        }`}
                        onClick={() => void toggleEnabled(row)}
                      >
                        {row.enabled ? "停用" : "启用"}
                      </button>
                      <button
                        type="button"
                        className="min-h-10 border border-danger/25 px-2 font-mono text-[11px] text-danger"
                        onClick={() => void deleteSource(row)}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="px-6 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">ID</th>
                  <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">名称</th>
                  <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">Tier</th>
                  <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">URL</th>
                  <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">状态</th>
                  <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">健康</th>
                  <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">最近成功</th>
                  <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">失败</th>
                  <th className="px-3 py-3 font-mono text-[11px] uppercase tracking-widest text-fg-soft">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td className="px-6 py-8 text-fg-muted" colSpan={9}>
                      暂无匹配信源。
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const healthRow = healthMap.get(row.id);
                    return (
                      <Fragment key={row.id}>
                        <tr
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
                          <td className="px-3 py-3">
                            {healthRow ? (
                              <span className={`font-mono text-xs ${HEALTH_BADGE[healthRow.health]}`}>
                                {HEALTH_LABEL[healthRow.health]}
                              </span>
                            ) : (
                              <span className="font-mono text-xs text-fg-soft">—</span>
                            )}
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
                                className={`min-h-8 rounded-none px-2 py-1 font-mono text-[11px] hover:bg-accent/10 ${
                                  editingSource?.id === row.id ? "bg-accent/10 text-accent" : "text-accent"
                                }`}
                                onClick={() => beginEdit(row)}
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                className={`min-h-8 rounded-none px-2 py-1 font-mono text-[11px] hover:bg-bg-deep ${
                                  row.enabled ? "text-warn" : "text-ok"
                                }`}
                                onClick={() => void toggleEnabled(row)}
                              >
                                {row.enabled ? "停用" : "启用"}
                              </button>
                              <button
                                type="button"
                                className="min-h-8 rounded-none px-2 py-1 font-mono text-[11px] text-danger hover:bg-danger/10"
                                onClick={() => void deleteSource(row)}
                              >
                                删除
                              </button>
                            </div>
                          </td>
                        </tr>
                        {healthRow?.lastError ? (
                          <tr>
                            <td colSpan={9} className="px-3 pb-3 pt-0">
                              <div className="flex items-start gap-2 border-l-2 border-danger/40 bg-danger/5 px-3 py-2">
                                <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-danger">
                                  最近错误
                                </span>
                                <span className="font-mono text-[11px] leading-relaxed text-fg-muted break-all">
                                  {healthRow.lastError}
                                  {healthRow.lastErrorAtIso ? (
                                    <span className="ml-2 text-fg-soft">
                                      · {relativeFromNow(healthRow.lastErrorAtIso)}
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
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
