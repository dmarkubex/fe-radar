"use client";

import { useMemo } from "react";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

interface QuotePoint {
  observedAt: string;
  value: string | null;
  changePct?: string | null;
}

interface BriefingLineChartProps {
  data: QuotePoint[];
  label: string;
  /** e.g. "万元/吨" */
  unit?: string;
}

const CHART_W = 320;
const CHART_H = 100;
const PAD_L = 48;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 24;
const INNER_W = CHART_W - PAD_L - PAD_R;
const INNER_H = CHART_H - PAD_T - PAD_B;

export function BriefingLineChart({ data, label, unit = "" }: BriefingLineChartProps): React.JSX.Element {
  const points = useMemo(
    () =>
      data
        .map((d) => ({ ...d, numVal: d.value !== null ? parseFloat(d.value) : null }))
        .filter((d): d is typeof d & { numVal: number } => d.numVal !== null),
    [data]
  );

  if (points.length === 0) {
    return (
      <div className="flex h-[100px] items-center justify-center text-[11px] text-fg-soft font-mono">
        暂无数据
      </div>
    );
  }

  const values = points.map((p) => p.numVal);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  const toX = (i: number): number => PAD_L + (i / Math.max(points.length - 1, 1)) * INNER_W;
  const toY = (v: number): number => PAD_T + INNER_H - ((v - minV) / range) * INNER_H;

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.numVal).toFixed(1)}`)
    .join(" ");

  const last = points[points.length - 1]!;
  const first = points[0]!;
  const diff = last.numVal - first.numVal;
  const strokeColor =
    diff >= 0
      ? "var(--color-market-up, #e74c3c)"
      : "var(--color-market-down, #27ae60)";

  // X-axis labels: show first and last dates
  const fmt = (iso: string): string =>
    dayjs(iso).tz(APP_TIMEZONE).format("M/D");

  // Y-axis: 3 ticks
  const yTicks = [minV, minV + range / 2, maxV];
  const useTenThousands = maxV >= 10000;
  const formatTick = (tick: number): string =>
    useTenThousands ? `${(tick / 10000).toFixed(2)}万` : Math.round(tick).toLocaleString("zh-CN");

  return (
    <div className="w-full">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[1px] text-fg-soft">{label}</span>
        <span className="font-mono text-[11px] text-fg">
          {last.numVal.toLocaleString("zh-CN")}
          {unit && <span className="ml-0.5 text-fg-soft text-[9px]">{unit}</span>}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        width="100%"
        style={{ aspectRatio: `${CHART_W}/${CHART_H}` }}
        aria-label={`${label} 7日折线图`}
        role="img"
      >
        {/* Y grid + labels */}
        {yTicks.map((tick, i) => {
          const y = toY(tick);
          return (
            <g key={i}>
              <line
                x1={PAD_L}
                y1={y}
                x2={CHART_W - PAD_R}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.08}
                strokeWidth={1}
              />
              <text
                x={PAD_L - 3}
                y={y + 3}
                textAnchor="end"
                fontSize={8}
                fill="currentColor"
                opacity={0.45}
              >
                {formatTick(tick)}
              </text>
            </g>
          );
        })}

        {/* Line */}
        <path d={pathD} fill="none" stroke={strokeColor} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />

        {/* Dots at first and last */}
        {[first, last].map((p, i) => {
          const idx = i === 0 ? 0 : points.length - 1;
          return (
            <circle
              key={i}
              cx={toX(idx)}
              cy={toY(p.numVal)}
              r={2.5}
              fill={strokeColor}
            />
          );
        })}

        {/* X axis labels */}
        {points.length > 1 && (
          <>
            <text x={toX(0)} y={CHART_H - 4} textAnchor="middle" fontSize={8} fill="currentColor" opacity={0.45}>
              {fmt(first.observedAt)}
            </text>
            <text x={toX(points.length - 1)} y={CHART_H - 4} textAnchor="middle" fontSize={8} fill="currentColor" opacity={0.45}>
              {fmt(last.observedAt)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
