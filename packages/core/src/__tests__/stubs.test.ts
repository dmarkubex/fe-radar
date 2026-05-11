import { describe, expect, it } from "vitest";
import { NotImplementedError } from "@fe-radar/shared";
import { admitToScoring, computeAlert, computeD2Chain, computeQualityScore, decideCluster, isPriorityItem } from "../index";

describe("core M0 stubs", () => {
  it("exports priority stub", () => {
    expect(() => isPriorityItem([], { d1Policy: 0, d2Chain: 0, d3Market: 0, d4Tech: 0, d5Business: 0 })).toThrow(NotImplementedError);
  });

  it("exports quota stub", () => {
    expect(() => admitToScoring({ itemId: 1, isPriority: false, businessDate: "2026-05-11" })).toThrow(NotImplementedError);
  });

  it("exports scoring stubs", () => {
    expect(() => computeD2Chain([])).toThrow(NotImplementedError);
    expect(() =>
      computeQualityScore(
        { d1Policy: 0, d2Chain: 0, d3Market: 0, d4Tech: 0, d5Business: 0 },
        { tier: "T1" },
        [],
        {
          weights: { w1: 0.2, w2: 0.25, w3: 0.2, w4: 0.15, w5: 0.2 },
          tCoef: { T1: 1, T2: 0.85, T3: 0.7 },
          cCoef: { C1: 1.2, C2: 1, C3: 0.85 }
        }
      )
    ).toThrow(NotImplementedError);
  });

  it("exports alert and cluster stubs", () => {
    expect(() =>
      computeAlert({
        source: { tier: "T1" },
        scores: { d1Policy: 0, d2Chain: 0, d3Market: 0, d4Tech: 0, d5Business: 0 },
        entities: []
      })
    ).toThrow(NotImplementedError);
    expect(() => decideCluster({ itemId: 1, embedding: [] })).toThrow(NotImplementedError);
  });
});
