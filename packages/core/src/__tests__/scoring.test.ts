import { describe, expect, it } from "vitest";
import { computeAlert, computeD2Chain, computeQualityScore, curateItem, isPriorityItem } from "../index";

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
