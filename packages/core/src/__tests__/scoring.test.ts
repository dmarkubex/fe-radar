import { describe, expect, it } from "vitest";
import type { EntityFinancialSnapshot } from "../types";
import { computeAlert, computeD2Chain, computeD3Market, computeQualityScore, curateItem, isPriorityItem } from "../index";

const config = {
  weights: { w1: 0.2, w2: 0.25, w3: 0.2, w4: 0.15, w5: 0.2 },
  tCoef: { T1: 1, T2: 0.85, T3: 0.7 },
  cCoef: { C1: 1.2, C2: 1, C3: 0.85 },
  thresholds: { "政策与标准": { C1: 55, C2: 60, C3: 65 } }
} as const;

describe("scoring and curator", () => {
  it("computes D2_chain from entities without LLM", () => {
    expect(computeD2Chain([{ id: 1, type: "company", canonicalName: "远东控股", circle: "C1" }])).toBeGreaterThan(90);
  });

  it("applies tier and circle coefficients", () => {
    const result = computeQualityScore(
      { d1Policy: 50, d2Chain: 90, d3Market: 50, d4Tech: 50, d5Business: 50 },
      { tier: "T1" },
      [{ id: 1, type: "company", canonicalName: "远东控股", circle: "C1" }],
      config
    );
    expect(result.topCircle).toBe("C1");
    expect(result.qualityScore).toBeGreaterThan(65);
  });

  it("computes alert through the single alert entrypoint", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { d1Policy: 20, d2Chain: 95, d3Market: 0, d4Tech: 0, d5Business: 0 },
      entities: [{ id: 1, type: "company", canonicalName: "远东控股", circle: "C1" }]
    }).alertType).toBe("own");
  });

  it("curates C1 items even when threshold changes", () => {
    const result = curateItem({
      atoms: { d1Policy: 20, d3Market: 20, d4Tech: 20, d5Business: 20 },
      source: { tier: "T1" },
      entities: [{ id: 1, type: "company", canonicalName: "远东控股", circle: "C1" }],
      category: "政策与标准",
      config: { ...config, thresholds: { "政策与标准": { C1: 99 } } }
    });
    expect(result.alertType).toBe("own");
    expect(result.isCurated).toBe(true);
  });

  it("detects priority items from C1 or high policy scores", () => {
    expect(isPriorityItem([], { d1Policy: 90, d2Chain: 0, d3Market: 0, d4Tech: 0, d5Business: 0 })).toBe(true);
  });

  it("maps every C1 sample to own alert", () => {
    const ownAlerts = Array.from({ length: 10 }, (_, index) => computeAlert({
      source: { tier: "T2" },
      scores: { d1Policy: index, d2Chain: 90, d3Market: 0, d4Tech: 0, d5Business: 0 },
      entities: [{ id: index, type: "company", canonicalName: `C1-${index}`, circle: "C1" }]
    }));
    expect(ownAlerts.every((alert) => alert.alertType === "own")).toBe(true);
  });
});

describe("computeD3Market", () => {
  it("clamps to 100 when all metrics are strong", () => {
    const financials: EntityFinancialSnapshot[] = [
      { metric: "roe", value: 18, period: "2024-Q4" },
      { metric: "revenue_growth", value: 25, period: "2024-Q4" },
      { metric: "net_profit_growth", value: 22, period: "2024-Q4" }
    ];
    expect(computeD3Market(financials)).toBe(100);
  });

  it("scores 76 for mid-range metrics", () => {
    const financials: EntityFinancialSnapshot[] = [
      { metric: "roe", value: 12, period: "2024-Q4" },
      { metric: "revenue_growth", value: 15, period: "2024-Q4" },
      { metric: "net_profit_growth", value: 12, period: "2024-Q4" }
    ];
    expect(computeD3Market(financials)).toBe(76);
  });

  it("clamps to 0 when all metrics are negative", () => {
    const financials: EntityFinancialSnapshot[] = [
      { metric: "roe", value: -5, period: "2024-Q4" },
      { metric: "revenue_growth", value: -10, period: "2024-Q4" },
      { metric: "net_profit_growth", value: -8, period: "2024-Q4" }
    ];
    expect(computeD3Market(financials)).toBe(0);
  });

  it("returns null for empty financials", () => {
    expect(computeD3Market([])).toBeNull();
  });

  it("returns null when financials lack all three target metrics", () => {
    const financials: EntityFinancialSnapshot[] = [
      { metric: "debt_ratio", value: 40, period: "2024-Q4" },
      { metric: "gross_margin", value: 30, period: "2024-Q4" }
    ];
    expect(computeD3Market(financials)).toBeNull();
  });

  it("scores base plus ROE adjustment when only ROE is present", () => {
    const financials: EntityFinancialSnapshot[] = [
      { metric: "roe", value: 18, period: "2024-Q4" }
    ];
    expect(computeD3Market(financials)).toBe(70);
  });

  it("picks the latest period when multiple snapshots exist for the same metric", () => {
    const financials: EntityFinancialSnapshot[] = [
      { metric: "roe", value: 12, period: "2024-Q2" },
      { metric: "roe", value: 18, period: "2024-Q4" }
    ];
    expect(computeD3Market(financials)).toBe(70);
  });

  it("matches metric names case-insensitively", () => {
    const financials: EntityFinancialSnapshot[] = [
      { metric: "ROE", value: 18, period: "2024-Q4" }
    ];
    expect(computeD3Market(financials)).toBe(70);
  });
});
