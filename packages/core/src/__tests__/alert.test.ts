import { describe, expect, it } from "vitest";
import { computeAlert } from "../alert";
import { LITIGATION_SOURCE_CATEGORY } from "../litigation";

describe("computeAlert risk type (企业风险 sourceCategory)", () => {
  it("emits own alert for C1 entity under 企业风险 (first branch takes priority)", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { d1Policy: 0, d2Chain: 70, d3Market: 0, d4Tech: 0, d5Business: 0 },
      entities: [{ id: 1, type: "company", canonicalName: "远东控股", circle: "C1" }],
      title: "某企业风险动态",
      sourceCategory: "企业风险",
    })).toEqual({ alertType: "own", alertLevel: "L2" });
  });

  it("emits risk alert for C2 entity under 企业风险 without C1", () => {
    expect(computeAlert({
      source: { tier: "T2" },
      scores: { d1Policy: 0, d2Chain: 60, d3Market: 0, d4Tech: 0, d5Business: 0 },
      entities: [{ id: 2, type: "company", canonicalName: "亨通光电", circle: "C2" }],
      title: "某企业风险动态",
      sourceCategory: "企业风险",
    })).toEqual({ alertType: "risk", alertLevel: "L2" });
  });

  it("does not emit alert for 企业风险 without C1/C2 entities", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { d1Policy: 0, d2Chain: 50, d3Market: 0, d4Tech: 0, d5Business: 0 },
      entities: [{ id: 3, type: "company", canonicalName: "某公司", circle: "C3" }],
      title: "某企业风险动态",
      sourceCategory: "企业风险",
    })).toEqual({});
  });

  it("still routes C2 litigation to legal branch (企业风险 branch does not interfere)", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { d1Policy: 0, d2Chain: 70, d3Market: 0, d4Tech: 0, d5Business: 0 },
      entities: [{ id: 2, type: "company", canonicalName: "亨通光电", circle: "C2" }],
      title: "关于收到民事判决书的公告",
      sourceCategory: LITIGATION_SOURCE_CATEGORY,
    })).toEqual({ alertType: "legal", alertLevel: "L2" });
  });
});
