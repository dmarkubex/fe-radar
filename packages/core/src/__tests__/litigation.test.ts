import { describe, expect, it } from "vitest";
import { computeAlert } from "../alert";
import { curateItem } from "../curator";
import { hasCompetitorCircle, LITIGATION_SOURCE_CATEGORY } from "../litigation";

const scoringConfig = {
  weights: { w1: 0.2, w2: 0.25, w3: 0.2, w4: 0.15, w5: 0.2 },
  tCoef: { T1: 1, T2: 0.85, T3: 0.7 },
  cCoef: { C1: 1.2, C2: 1, C3: 0.85 },
  thresholds: { "企业动态": { C1: 70, C2: 70, C3: 70 } },
} as const;

describe("litigation helpers", () => {
  it("detects competitor circle hits", () => {
    expect(hasCompetitorCircle([{ circle: "C2" }])).toBe(true);
    expect(hasCompetitorCircle([{ circle: "C3" }])).toBe(false);
  });
});

describe("computeAlert legal type", () => {
  it("prioritizes own alert over legal for C1 litigation", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { d1Policy: 0, d2Chain: 95, d3Market: 0, d4Tech: 0, d5Business: 0 },
      entities: [{ id: 1, type: "company", canonicalName: "远东控股", circle: "C1" }],
      title: "涉及诉讼的公告",
      sourceCategory: LITIGATION_SOURCE_CATEGORY,
    }).alertType).toBe("own");
  });

  it("emits legal alert for C2 competitor litigation", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { d1Policy: 0, d2Chain: 70, d3Market: 0, d4Tech: 0, d5Business: 70 },
      entities: [{ id: 2, type: "company", canonicalName: "亨通光电", circle: "C2" }],
      title: "关于收到民事判决书的公告",
      sourceCategory: LITIGATION_SOURCE_CATEGORY,
    })).toEqual({ alertType: "legal", alertLevel: "L2" });
  });

  it("does not emit legal alert from title keywords without source category", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { d1Policy: 0, d2Chain: 70, d3Market: 0, d4Tech: 0, d5Business: 70 },
      entities: [{ id: 2, type: "company", canonicalName: "亨通光电", circle: "C2" }],
      title: "关于收到民事判决书的公告",
    })).toEqual({});
  });
});

describe("curateItem legal alert integration", () => {
  it("curates C2 competitor litigation through computeAlert", () => {
    const result = curateItem({
      atoms: { d1Policy: 0, d3Market: 70, d4Tech: 0, d5Business: 70 },
      source: { tier: "T1" },
      entities: [{ id: 2, type: "company", canonicalName: "亨通光电", circle: "C2" }],
      category: "企业动态",
      title: "关于收到民事判决书的公告",
      sourceCategory: LITIGATION_SOURCE_CATEGORY,
      config: scoringConfig,
    });

    expect(result.alertType).toBe("legal");
    expect(result.alertLevel).toBe("L2");
    expect(result.isCurated).toBe(true);
  });

  it("does not emit legal alert without litigation source category", () => {
    const result = curateItem({
      atoms: { d1Policy: 0, d3Market: 70, d4Tech: 0, d5Business: 70 },
      source: { tier: "T1" },
      entities: [{ id: 2, type: "company", canonicalName: "亨通光电", circle: "C2" }],
      category: "企业动态",
      title: "关于收到民事判决书的公告",
      config: scoringConfig,
    });

    expect(result.alertType).toBeUndefined();
    expect(result.isCurated).toBe(false);
  });
});
