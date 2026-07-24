"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";
import type { PipelineFlowPayload } from "@/lib/api/pipeline-flow-query";
import {
  SOURCE_HEALTH_META,
  type SourceHealth,
} from "@/components/shared/source-health-meta";

import { PipelineFlow } from "./pipeline-flow";

const REFRESH_MS = 10000;

// ---- HTTP contract shapes (kept in sync with /api/admin/worker + /api/admin/source-health) ----

interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  paused: number;
}

interface QueueRow {
  key: string;
  label: string;
  counts: QueueCounts;
  nextRunIso: string | null;
}

interface WorkerStatus {
  redis: "ok" | "unreachable";
  heartbeat: {
    alive: boolean;
    lastSeenIso: string | null;
    ageSeconds: number | null;
    instances: number;
  };
  queues: QueueRow[];
}

interface SourceRow {
  id: number;
  name: string;
  tier: "T1" | "T2" | "T3";
  fetcherType: string;
  enabled: boolean;
  lastOkAtIso: string | null;
  failCount: number;
  health: SourceHealth;
  staleHours: number | null;
  nextFetchIso: string | null;
  lastError: string | null;
  lastErrorAtIso: string | null;
}

interface SourceHealthResponse {
  summary: {
    healthy: number;
    stale: number;
    failing: number;
    disabled: number;
  };
  sources: SourceRow[];
}

// ---- helpers ----

// Manual relative-time formatter: the shared dayjs build only extends utc +
// timezone (no relativeTime plugin), so we compute the diff by hand. Handles
// both past ("N 分钟前") and future ("N 分钟后") timestamps.
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

export function WorkerMonitor(): React.JSX.Element {
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [health, setHealth] = useState<SourceHealthResponse | null>(null);
  const [pipelineFlow, setPipelineFlow] = useState<PipelineFlowPayload | null>(null);
  const [loading, setLoading] = useState(true);
  // Independent per-panel errors so a flaky source-health (DB) query doesn't
  // hide live worker/Redis status, and vice versa.
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [pipelineFlowError, setPipelineFlowError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const fetchJson = async <T,>(url: string): Promise<T> => {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    };

    const [workerResult, healthResult, pipelineFlowResult] = await Promise.allSettled([
      fetchJson<WorkerStatus>("/api/admin/worker"),
      fetchJson<SourceHealthResponse>("/api/admin/source-health"),
      fetchJson<PipelineFlowPayload>("/api/admin/pipeline-flow"),
    ]);

    if (workerResult.status === "fulfilled") {
      setWorker(workerResult.value);
      setWorkerError(null);
    } else {
      setWorkerError(workerResult.reason instanceof Error ? workerResult.reason.message : "请求失败");
    }

    if (healthResult.status === "fulfilled") {
      setHealth(healthResult.value);
      setHealthError(null);
    } else {
      setHealthError(healthResult.reason instanceof Error ? healthResult.reason.message : "请求失败");
    }

    if (pipelineFlowResult.status === "fulfilled") {
      setPipelineFlow(pipelineFlowResult.value);
      setPipelineFlowError(null);
    } else {
      setPipelineFlow(null);
      setPipelineFlowError(
        pipelineFlowResult.reason instanceof Error ? pipelineFlowResult.reason.message : "请求失败"
      );
    }

    setLastUpdated(dayjs().tz(APP_TIMEZONE).format("HH:mm:ss"));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (loading && !worker && !health) {
    return (
      <div className="panel-surface p-6">
        <p className="font-mono text-xs text-fg-muted">加载中…</p>
      </div>
    );
  }

  if (!worker && !health && workerError && healthError) {
    return (
      <div className="border border-danger/40 bg-danger/5 p-6 shadow-card">
        <p className="font-mono text-[11px] uppercase tracking-widest text-danger">
          加载失败
        </p>
        <p className="mt-2 font-mono text-xs text-fg-muted">worker: {workerError} · source-health: {healthError}</p>
      </div>
    );
  }

  const alive = worker?.heartbeat.alive ?? false;
  const ageSeconds = worker?.heartbeat.ageSeconds ?? null;
  const instances = worker?.heartbeat.instances ?? 0;
  const redisOk = worker?.redis === "ok";

  return (
    <div className="space-y-8">
      {/* ---- Pipeline flow (top) ---- */}
      <PipelineFlow
        payload={pipelineFlow}
        error={pipelineFlowError}
        onRetry={() => void load()}
        queues={worker?.queues}
      />

      {/* ---- Worker status header ---- */}
      <section className="panel-surface p-6">
        <div className="flex items-baseline justify-between border-b border-hairline pb-3">
          <h3 className="font-display text-base font-semibold text-fg">Worker 心跳</h3>
          <span className="font-mono text-[11px] text-fg-soft">
            {lastUpdated ? `更新 ${lastUpdated}` : "—"}
            {workerError ? " · 刷新失败" : ""}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 border px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wide ${
              alive
                ? "border-ok/40 bg-ok/10 text-ok"
                : "border-danger/40 bg-danger/10 text-danger"
            }`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${alive ? "bg-ok" : "bg-danger"}`}
            />
            {alive ? "运行中" : "已离线"}
          </span>
          <span className="font-mono text-xs text-fg-muted">
            最后心跳{" "}
            <span className="tabular-nums text-fg">
              {ageSeconds === null ? "—" : `${ageSeconds} 秒前`}
            </span>
          </span>
          {instances > 1 ? (
            <span className="font-mono text-xs text-fg-muted">
              · <span className="tabular-nums text-fg">{instances}</span> 实例
            </span>
          ) : null}
          <span
            className={`inline-flex items-center gap-1.5 border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide ${
              redisOk
                ? "border-ok/40 bg-ok/10 text-ok"
                : "border-danger/40 bg-danger/10 text-danger"
            }`}
          >
            Redis: {redisOk ? "ok" : "unreachable"}
          </span>
        </div>
      </section>

      {/* ---- Queue table ---- */}
      <section className="panel-surface p-6">
        <div className="flex items-baseline justify-between border-b border-hairline pb-3">
          <h3 className="font-display text-base font-semibold text-fg">队列状态</h3>
          <span className="font-mono text-[11px] text-fg-soft">
            BullMQ · {worker?.queues.length ?? 0} 队列
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className="py-3 pr-4 eyebrow">
                  队列
                </th>
                {(["等待", "处理中", "延迟", "完成", "失败", "暂停"] as const).map((h) => (
                  <th
                    key={h}
                    className="px-3 py-3 text-right eyebrow"
                  >
                    {h}
                  </th>
                ))}
                <th className="px-3 py-3 text-right eyebrow">
                  下次运行
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {worker?.queues.map((q) => (
                <tr key={q.key}>
                  <td className="py-3 pr-4 text-sm text-fg">
                    <span className="text-fg">{q.label}</span>{" "}
                    <span className="font-mono text-[10px] text-fg-soft">{q.key}</span>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-fg">
                    {q.counts.waiting}
                  </td>
                  <td
                    className={`px-3 py-3 text-right font-mono text-xs tabular-nums ${
                      q.counts.active > 0 ? "text-ok" : "text-fg"
                    }`}
                  >
                    {q.counts.active}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-fg">
                    {q.counts.delayed}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-fg-muted">
                    {q.counts.completed}
                  </td>
                  <td
                    className={`px-3 py-3 text-right font-mono text-xs tabular-nums ${
                      q.counts.failed > 0 ? "text-danger" : "text-fg"
                    }`}
                  >
                    {q.counts.failed}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-fg-muted">
                    {q.counts.paused}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-fg-muted">
                    {relativeFromNow(q.nextRunIso)}
                  </td>
                </tr>
              ))}
              {(worker?.queues.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center font-mono text-xs text-fg-soft">
                    {workerError ? `worker 监控请求失败：${workerError}` : redisOk ? "无队列数据" : "Redis 不可达，无队列数据"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Source health ---- */}
      <section className="panel-surface p-6">
        <div className="flex items-baseline justify-between border-b border-hairline pb-3">
          <h3 className="font-display text-base font-semibold text-fg">信源健康</h3>
          <span className="font-mono text-[11px] text-fg-soft">
            共 {health?.sources.length ?? 0} 源
            {healthError ? <span className="text-danger"> · 刷新失败</span> : ""}
          </span>
        </div>

        {/* summary cells */}
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {(
            [
              { key: "healthy", ...SOURCE_HEALTH_META.healthy },
              { key: "stale", ...SOURCE_HEALTH_META.stale },
              { key: "failing", ...SOURCE_HEALTH_META.failing },
              { key: "disabled", ...SOURCE_HEALTH_META.disabled },
            ] as const
          ).map((cell) => (
            <div key={cell.key} className="border border-border bg-bg p-3">
              <p className="font-mono text-[13px] uppercase tracking-widest text-fg-soft">
                {cell.label}
              </p>
              <p className={`mt-1 font-display text-3xl tabular-nums ${cell.className}`}>
                {health?.summary[cell.key] ?? 0}
              </p>
            </div>
          ))}
        </div>

        {/* source table */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className="py-3 pr-4 eyebrow">
                  信源
                </th>
                <th className="px-3 py-3 eyebrow">
                  Tier
                </th>
                <th className="px-3 py-3 eyebrow">
                  类型
                </th>
                <th className="px-3 py-3 eyebrow">
                  状态
                </th>
                <th className="px-3 py-3 eyebrow">
                  最近成功
                </th>
                <th className="px-3 py-3 text-right eyebrow">
                  失败数
                </th>
                <th className="px-3 py-3 text-right eyebrow">
                  下次抓取
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {health?.sources.map((s) => (
                <Fragment key={s.id}>
                <tr>
                  <td className="py-3 pr-4 text-sm text-fg">{s.name}</td>
                  <td className="px-3 py-3 font-mono text-xs text-fg-muted">{s.tier}</td>
                  <td className="px-3 py-3 font-mono text-xs text-fg-muted">{s.fetcherType}</td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${SOURCE_HEALTH_META[s.health].className}`}
                    >
                      {SOURCE_HEALTH_META[s.health].label}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-fg-muted">
                    {s.lastOkAtIso ? relativeFromNow(s.lastOkAtIso) : "从未"}
                  </td>
                  <td
                    className={`px-3 py-3 text-right font-mono text-xs tabular-nums ${
                      s.failCount > 0 ? "text-danger" : "text-fg"
                    }`}
                  >
                    {s.failCount}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-fg-muted">
                    {relativeFromNow(s.nextFetchIso)}
                  </td>
                </tr>
                {s.lastError ? (
                  <tr>
                    <td colSpan={7} className="px-3 pb-3 pt-0">
                      <div className="flex items-start gap-2 border-l-2 border-danger/40 bg-danger/5 px-3 py-2">
                        <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-danger">最近错误</span>
                        <span className="font-mono text-[11px] leading-relaxed text-fg-muted break-all">
                          {s.lastError}
                          {s.lastErrorAtIso ? <span className="ml-2 text-fg-soft">· {relativeFromNow(s.lastErrorAtIso)}</span> : null}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              ))}
              {(health?.sources.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center font-mono text-xs text-fg-soft">
                    无信源数据
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
