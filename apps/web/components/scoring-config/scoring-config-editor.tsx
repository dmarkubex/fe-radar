"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ScoringConfigBody } from "@/lib/api/scoring-config-schema";

const DIM_LABELS: { key: keyof ScoringConfigBody["weights"]; label: string; tooltip: string }[] = [
  {
    key: "w1",
    label: "D1 · 政策法规",
    tooltip: "D1 政策法规权重：涉及国标、政策、补贴、许可证、规划的程度（0-100）。由 DeepSeek 对文本打分。"
  },
  {
    key: "w2",
    label: "D2 · 产业链关联",
    tooltip: "D2 产业链关联度：NER 命中 C1/C2/C3 关注圈实体后由代码计算，非 LLM 打分。命中圈层越深、实体数越多得分越高，确保自家公司零漏报。"
  },
  {
    key: "w3",
    label: "D3 · 市场价格",
    tooltip: "D3 市场/价格信号：含价格行情、招投标金额、产能数据的程度（0-100）。由 DeepSeek 对文本打分。"
  },
  {
    key: "w4",
    label: "D4 · 技术标准",
    tooltip: "D4 技术/标准突破：涉及新材料、新工艺、新国标、新认证的程度（0-100）。由 DeepSeek 对文本打分。"
  },
  {
    key: "w5",
    label: "D5 · 商业机会",
    tooltip: "D5 商业机会/风险：大订单、并购、财报、安全事故、关税、人事变动等信号（0-100）。由 DeepSeek 对文本打分。"
  },
];

// Keys MUST match the item `category` strings used by the scoring pipeline
// (packages/core/curator.ts looks up `thresholds[item.category][topCircle]`),
// the LLM scorer enum, the worker defaults, and the 0002 seed migration.
// Using anything else makes every cell read undefined → render 0 and any edit
// silently no-ops in curation.
const THRESHOLD_ROWS = [
  { key: "政策与标准", label: "政策与标准" },
  { key: "市场与价格", label: "市场与价格" },
  { key: "技术与产品", label: "技术与产品" },
  { key: "项目与招投标", label: "项目与招投标" },
  { key: "公司与资本", label: "公司与资本" },
];

const ALERT_RULES = [
  { name: "自家公司命中", condition: "D2_chain 命中 ≥ 1 个 C1 实体", channels: "钉钉 + 站内", priority: "critical" as const },
  { name: "安全合规告警", condition: "score ≥ C1 threshold + safety 类别", channels: "钉钉 + 站内", priority: "critical" as const },
  { name: "政策变动告警", condition: "score ≥ C2 threshold + policy 类别", channels: "站内", priority: "warning" as const },
  { name: "市场异动", condition: "24h 内同类 ≥ 3 条 + score ≥ C2", channels: "站内", priority: "info" as const },
];

function priorityBadge(p: "critical" | "warning" | "info"): string {
  if (p === "critical") return "bg-danger/10 text-danger";
  if (p === "warning") return "bg-warn/10 text-warn";
  return "bg-accent/10 text-accent";
}

interface EditorProps {
  initialValue: ScoringConfigBody;
}

export function ScoringConfigEditor({ initialValue }: EditorProps): React.JSX.Element {
  const [weights, setWeights] = useState<ScoringConfigBody["weights"]>({
    ...initialValue.weights,
  });
  const [tCoef, setTCoef] = useState<ScoringConfigBody["tCoef"]>({ ...initialValue.tCoef });
  const [cCoef, setCCoef] = useState<ScoringConfigBody["cCoef"]>({ ...initialValue.cCoef });
  const [thresholds, setThresholds] = useState<ScoringConfigBody["thresholds"]>({
    ...initialValue.thresholds,
  });
  const [status, setStatus] = useState<string>("");
  const [dirty, setDirty] = useState(false);

  const wSum = Object.values(weights).reduce((s, v) => s + v, 0);
  const wValid = Math.abs(wSum - 1) < 0.0001;

  const markDirty = useCallback(() => setDirty(true), []);

  function setWeight(key: keyof ScoringConfigBody["weights"], raw: string) {
    const v = parseFloat(raw);
    if (isNaN(v)) return;
    setWeights((prev) => ({ ...prev, [key]: v }));
    markDirty();
  }

  function setThresholdRow(rowKey: string, col: "C1" | "C2" | "C3", raw: string) {
    const v = parseFloat(raw);
    if (isNaN(v)) return;
    setThresholds((prev) => {
      const existing = prev[rowKey] ?? { C1: 0, C2: 0, C3: 0 };
      return { ...prev, [rowKey]: { C1: existing.C1, C2: existing.C2, C3: existing.C3, [col]: v } };
    });
    markDirty();
  }

  function setTCoefVal(tier: "T1" | "T2" | "T3", raw: string) {
    const v = parseFloat(raw);
    if (isNaN(v)) return;
    setTCoef((prev) => ({ ...prev, [tier]: v }));
    markDirty();
  }

  function setCCoefVal(circle: "C1" | "C2" | "C3", raw: string) {
    const v = parseFloat(raw);
    if (isNaN(v)) return;
    setCCoef((prev) => ({ ...prev, [circle]: v }));
    markDirty();
  }

  async function save(): Promise<void> {
    setStatus("保存中…");
    const body: ScoringConfigBody = { weights, tCoef, cCoef, thresholds };
    try {
      const response = await fetch("/api/scoring-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setStatus(`保存失败：${payload?.error?.message ?? "请检查权重和是否为 1.00"}`);
        return;
      }
      setStatus("已保存 ✓");
      setDirty(false);
    } catch {
      setStatus("保存失败：网络异常，请稍后重试");
    }
  }

  return (
    <>
      <section>
        {/* left: 5D weight sliders */}
        <div className="panel-surface p-6">
          <div className="flex items-baseline justify-between border-b border-hairline pb-3">
            <h3 className="font-display text-base font-semibold text-fg">
              5 维权重
            </h3>
            <span
              className={`font-mono text-[11px] ${wValid ? "text-ok" : "text-danger"}`}
            >
              Σ = {wSum.toFixed(2)}
            </span>
          </div>

          <div className="mt-5 space-y-5">
            {DIM_LABELS.map((dim) => {
              const val = weights[dim.key];
              return (
                <div key={dim.key} className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="flex items-center gap-1 font-mono text-xs text-fg-muted">
                      {dim.label}
                      <span
                        title={dim.tooltip}
                        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-fg-soft/40 font-mono text-[9px] text-fg-soft hover:border-accent hover:text-accent"
                      >
                        ?
                      </span>
                    </span>
                    <span className="font-mono text-xs tabular-nums text-fg">
                      {val.toFixed(2)}
                    </span>
                  </div>
                  {/* visual slider bar */}
                  <div className="flex items-center gap-3">
                    <div className="h-2 flex-1 bg-bg-deep">
                      <div
                        className="h-full bg-accent-flame transition-all"
                        style={{ width: `${Math.min(val * 100, 100)}%` }}
                      />
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={val}
                      onChange={(e) => setWeight(dim.key, e.target.value)}
                      className="w-16 border border-border bg-bg px-2 py-1 text-right font-mono text-xs tabular-nums text-fg focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* w-sum bar */}
          <div className="mt-6 border-t border-hairline pt-4">
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">
                权重总和
              </span>
              <span
                className={`font-display text-lg font-semibold ${wValid ? "text-ok" : "text-danger"}`}
              >
                {wSum.toFixed(2)} / 1.00
              </span>
            </div>
            <div className="mt-2 h-3 w-full bg-bg-deep">
              <div
                className={`h-full transition-all ${wValid ? "bg-ok" : "bg-danger"}`}
                style={{ width: `${Math.min(wSum * 100, 100)}%` }}
              />
            </div>
          </div>

          {/* Tier / Circle coefficients */}
          <div className="mt-6 border-t border-hairline pt-4 space-y-4">
            <h4 className="eyebrow">
              Tier 系数
            </h4>
            <div className="grid grid-cols-3 gap-3">
              {(["T1", "T2", "T3"] as const).map((tier) => (
                <div key={tier}>
                  <label className="mb-1 block font-mono text-[11px] text-fg-muted">
                    {tier}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={tCoef[tier]}
                    onChange={(e) => setTCoefVal(tier, e.target.value)}
                    className="w-full border border-border bg-bg px-2 py-1 text-right font-mono text-xs tabular-nums text-fg focus:outline-none focus:border-accent"
                  />
                </div>
              ))}
            </div>

            <h4 className="eyebrow">
              关注圈系数
            </h4>
            <div className="grid grid-cols-3 gap-3">
              {(["C1", "C2", "C3"] as const).map((circle) => (
                <div key={circle}>
                  <label className="mb-1 block font-mono text-[11px] text-fg-muted">
                    {circle}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={cCoef[circle]}
                    onChange={(e) => setCCoefVal(circle, e.target.value)}
                    className="w-full border border-border bg-bg px-2 py-1 text-right font-mono text-xs tabular-nums text-fg focus:outline-none focus:border-accent"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

      </section>

      {/* ---- Threshold matrix ---- */}
      <section className="panel-surface p-6">
        <div className="flex items-baseline justify-between border-b border-hairline pb-3">
          <h3 className="font-display text-base font-semibold text-fg">
            阈值矩阵
          </h3>
          <span className="font-mono text-[11px] text-fg-soft">
            分类 × 关注圈
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className="py-3 pr-4 eyebrow">
                  分类
                </th>
                <th className="px-3 py-3 text-center eyebrow">
                  C1
                </th>
                <th className="px-3 py-3 text-center eyebrow">
                  C2
                </th>
                <th className="px-3 py-3 text-center eyebrow">
                  C3
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {THRESHOLD_ROWS.map((row) => {
                const rowVals = thresholds[row.key] ?? { C1: 0, C2: 0, C3: 0 };
                return (
                  <tr key={row.key}>
                    <td className="py-3 pr-4 font-mono text-xs text-fg">
                      {row.label}
                    </td>
                    {(["C1", "C2", "C3"] as const).map((col) => (
                      <td key={col} className="px-3 py-3 text-center">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={rowVals[col]}
                          onChange={(e) => setThresholdRow(row.key, col, e.target.value)}
                          className="w-20 border border-border bg-bg px-2 py-1 text-center font-mono text-xs tabular-nums text-fg focus:outline-none focus:border-accent"
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Alert rules ---- */}
      <section className="panel-surface p-6">
        <div className="flex items-baseline justify-between border-b border-hairline pb-3">
          <h3 className="font-display text-base font-semibold text-fg">
            告警规则
          </h3>
          <span className="font-mono text-[11px] text-fg-soft">
            computeAlert() 单一入口
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className="py-3 pr-4 eyebrow">
                  规则
                </th>
                <th className="px-3 py-3 eyebrow">
                  条件
                </th>
                <th className="px-3 py-3 eyebrow">
                  通道
                </th>
                <th className="px-3 py-3 eyebrow">
                  优先级
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {ALERT_RULES.map((rule) => (
                <tr key={rule.name}>
                  <td className="py-3 pr-4 font-medium text-fg">{rule.name}</td>
                  <td className="px-3 py-3 font-mono text-xs text-fg-muted">
                    {rule.condition}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-fg-muted">
                    {rule.channels}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-block rounded-none px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${priorityBadge(rule.priority)}`}
                    >
                      {rule.priority === "critical"
                        ? "高"
                        : rule.priority === "warning"
                          ? "中"
                          : "低"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Sticky save bar ---- */}
      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface-deep/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <span className="font-mono text-xs text-fg-muted">
              {status}
            </span>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="border border-border px-4 py-2 font-mono text-xs text-fg-muted transition-colors hover:bg-bg-deep"
              >
                重置
              </button>
              <Button
                type="button"
                disabled={!wValid}
                onClick={() => void save()}
                variant="accent"
              >
                保存配置
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
