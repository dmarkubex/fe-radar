"use client";

import { useState } from "react";
import type { PipelineFlowPayload, PipelineStageKey } from "@/lib/api/pipeline-flow-query";

import {
  getStageSourceLights,
  lightToClass,
  lightToLabel,
  queueToNodeLight,
  type QueueRow
} from "./pipeline-flow-helpers";

export type { PipelineFlowPayload } from "@/lib/api/pipeline-flow-query";
export {
  lightToClass,
  lightToLabel,
  queueToNodeLight,
  getStageSourceLights
} from "./pipeline-flow-helpers";

export interface PipelineFlowProps {
  payload: PipelineFlowPayload | null;
  error: string | null;
  onRetry: () => void;
  queues?: ReadonlyArray<QueueRow>;
}

function findQueue(queues: ReadonlyArray<QueueRow> | undefined, stageKey: PipelineStageKey): QueueRow | undefined {
  if (!queues) return undefined;
  return queues.find((q) => q.key === stageKey);
}

export function PipelineFlow({ payload, error, onRetry, queues }: PipelineFlowProps): React.JSX.Element {
  const [expanded, setExpanded] = useState<PipelineStageKey | null>(null);

  const toggle = (key: PipelineStageKey): void => {
    setExpanded((prev) => (prev === key ? null : key));
  };

  if (error) {
    return (
      <section className="panel-surface p-6">
        <div className="flex items-baseline justify-between border-b border-hairline pb-3">
          <h3 className="font-display text-base font-semibold text-fg">流水线流程</h3>
          <span className="font-mono text-[11px] text-danger">加载失败</span>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span className="font-mono text-xs text-fg-muted">{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="border border-border bg-bg px-3 py-1 font-mono text-xs uppercase tracking-widest text-fg hover:border-ok/40 hover:text-ok"
          >
            重试
          </button>
        </div>
      </section>
    );
  }

  if (!payload) {
    return (
      <section className="panel-surface p-6">
        <div className="flex items-baseline justify-between border-b border-hairline pb-3">
          <h3 className="font-display text-base font-semibold text-fg">流水线流程</h3>
          <span className="font-mono text-[11px] text-fg-soft">加载中…</span>
        </div>
        <div className="mt-4 flex items-center gap-2 font-mono text-xs text-fg-soft">
          <span>暂无流程数据</span>
        </div>
      </section>
    );
  }

  const stages = payload.stages;

  return (
    <section className="panel-surface p-6">
      <div className="flex items-baseline justify-between border-b border-hairline pb-3">
        <h3 className="font-display text-base font-semibold text-fg">流水线流程</h3>
        <span className="font-mono text-[11px] text-fg-soft">
          {payload.sources.length} 信源 · {stages.length} 阶段
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <div className="flex min-w-fit items-stretch gap-2">
          {stages.map((stage, index) => {
            const queue = findQueue(queues, stage.key);
            const nodeLight = queueToNodeLight(queue?.counts);
            const nodeClass = lightToClass(nodeLight);
            const isOpen = expanded === stage.key;

            return (
              <div key={stage.key} className="flex items-stretch">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => toggle(stage.key)}
                    aria-expanded={isOpen}
                    className={`flex w-24 flex-col items-start gap-1 border bg-bg px-3 py-2 text-left transition-colors ${
                      isOpen ? "border-ok/40" : "border-border"
                    }`}
                  >
                    <span className="font-mono text-[10px] uppercase tracking-widest text-fg-soft">
                      {index + 1}
                    </span>
                    <span className="font-display text-sm font-semibold text-fg">{stage.label}</span>
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          nodeLight === "green"
                            ? "bg-ok"
                            : nodeLight === "yellow"
                              ? "bg-warn"
                              : nodeLight === "red"
                                ? "bg-danger"
                                : "bg-fg-soft"
                        }`}
                        title={lightToLabel(nodeLight)}
                        aria-hidden="true"
                      />
                      <span className={`font-mono text-[10px] uppercase tracking-widest ${nodeClass}`}>
                        {lightToLabel(nodeLight)}
                      </span>
                    </span>
                  </button>
                </div>

                {index < stages.length - 1 ? (
                  <div
                    aria-hidden="true"
                    className="flex w-6 shrink-0 items-center justify-center font-mono text-sm text-fg-soft"
                  >
                    →
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {expanded ? (
          <div className="mt-4 border border-hairline bg-bg p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <h4 className="eyebrow">
                阶段详情 · {stages.find((s) => s.key === expanded)?.label ?? ""}
              </h4>
              <span className="font-mono text-[11px] text-fg-soft">{payload.sources.length} 信源</span>
            </div>
            <ul className="divide-y divide-hairline">
              {getStageSourceLights(payload, expanded).map((row) => {
                const dotClass = lightToClass(row.light);
                const dotBg =
                  row.light === "green"
                    ? "bg-ok"
                    : row.light === "yellow"
                      ? "bg-warn"
                      : row.light === "red"
                        ? "bg-danger"
                        : "bg-fg-soft";
                return (
                  <li
                    key={row.id}
                    className="flex items-center justify-between py-1.5 text-xs"
                    title={lightToLabel(row.light)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-fg-soft">{row.tier}</span>
                      <span className="text-fg">{row.name}</span>
                    </div>
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className={`inline-block h-2 w-2 rounded-full ${dotBg}`}
                      />
                      <span className={`font-mono text-[11px] uppercase tracking-widest ${dotClass}`}>
                        {lightToLabel(row.light)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
