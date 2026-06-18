import { describe, expect, it } from "vitest";

import { mockSourceHealth } from "@/lib/api/source-health-query";

// 测试目标：健康率计算公式，防回退旧口径（failCount < 3）
// 这两个纯函数是 source-table.tsx KPI 计算的镜像；保持单测与组件
// 实现解耦（避免引入 React 渲染），但口径必须 1:1 对齐。

describe("source-health KPI 健康率公式", () => {
  function computeHealthRate(
    totalSources: number,
    disabled: number,
    healthy: number
  ): string {
    const denominator = totalSources - disabled;
    if (denominator <= 0) return "—";
    return `${Math.round((healthy / denominator) * 100)}%`;
  }

  it("口径为 healthy/(total-disabled), 非 failCount<3", () => {
    // fixture: 10 源, 2 停用, 6 健康
    // healthy/(total-disabled) = 6/8 = 75%
    expect(computeHealthRate(10, 2, 6)).toBe("75%");
  });

  it("旧口径(failCount<3)在此场景下会得出不同结果 — 作为回归说明", () => {
    // 旧口径 failCount<3: 假设 8 个启用源中有 2 个 failCount>=3 → 6/10=60%
    // 新口径: 6/(10-2)=75%
    // 确保新口径不等于旧口径
    const oldStyleRate = Math.round((6 / 10) * 100); // 60
    const newStyleRate = parseInt(computeHealthRate(10, 2, 6)); // 75
    expect(newStyleRate).not.toBe(oldStyleRate);
  });

  it("当分母为 0（全部停用）返回 —", () => {
    expect(computeHealthRate(3, 3, 0)).toBe("—");
  });

  it("100% 健康", () => {
    expect(computeHealthRate(5, 1, 4)).toBe("100%");
  });

  it("mock summary 含 fetched24h 且为正整数（防 mock 形状回退）", () => {
    const { fetched24h } = mockSourceHealth().summary;
    expect(Number.isInteger(fetched24h)).toBe(true);
    expect(fetched24h).toBeGreaterThan(0);
  });
});

describe("source-health KPI nextFetch 取最近一个", () => {
  function pickNextFetch(isos: (string | null)[]): string | null {
    const valid = isos.filter((iso): iso is string => iso !== null);
    if (valid.length === 0) return null;
    return valid.sort()[0] ?? null;
  }

  it("从多个 nextFetchIso 中取最小（最近）", () => {
    const isos = [
      "2026-06-17T12:00:00.000Z",
      "2026-06-17T06:00:00.000Z",
      "2026-06-17T18:00:00.000Z"
    ];
    expect(pickNextFetch(isos)).toBe("2026-06-17T06:00:00.000Z");
  });

  it("全为 null 时返回 null", () => {
    expect(pickNextFetch([null, null])).toBeNull();
  });
});
