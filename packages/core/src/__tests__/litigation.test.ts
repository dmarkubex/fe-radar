import { describe, expect, it } from "vitest";
import { computeAlert } from "../alert";
import { hasCompetitorCircle, LITIGATION_SOURCE_CATEGORY } from "../litigation";

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
