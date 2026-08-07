import { describe, expect, it } from "vitest";
import { computeAlert, alertLevelFromTier } from "../alert";
import { LITIGATION_SOURCE_CATEGORY } from "../litigation";

const zeroScores = { d1Policy: 0, d2Chain: 0, d3Market: 0, d4Tech: 0, d5Business: 0 };

describe("computeAlert own (Far East only)", () => {
  it("emits own for Far East synonym entities with tier-based level", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { ...zeroScores, d2Chain: 95 },
      entities: [{ id: 1, type: "company", canonicalName: "远东控股", circle: "C1" }],
    })).toEqual({ alertType: "own", alertLevel: "L1" });

    expect(computeAlert({
      source: { tier: "T3" },
      scores: { ...zeroScores, d2Chain: 90 },
      entities: [{ id: 1, type: "company", canonicalName: "远东电缆", circle: "C1" }],
    })).toEqual({ alertType: "own", alertLevel: "L3" });
  });

  it("does not emit own for other C1 entities (core customers / regulators)", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { ...zeroScores, d2Chain: 95 },
      entities: [{ id: 2, type: "company", canonicalName: "国家电网", circle: "C1" }],
    })).toEqual({});

    expect(computeAlert({
      source: { tier: "T1" },
      scores: { ...zeroScores, d2Chain: 95 },
      entities: [{ id: 3, type: "company", canonicalName: "国家发改委", circle: "C1" }],
    })).toEqual({});
  });
});

describe("computeAlert safety", () => {
  it("requires event_type=事故, d5Business >= 70, and an industry subject entity", () => {
    expect(computeAlert({
      source: { tier: "T2" },
      scores: { ...zeroScores, d5Business: 75 },
      entities: [
        { id: 1, type: "event_type", canonicalName: "事故" },
        { id: 2, type: "company", canonicalName: "某电缆厂", circle: "C3" },
      ],
    })).toEqual({ alertType: "safety", alertLevel: "L2" });
  });

  it("retains a real product-anchored industry safety alert", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { ...zeroScores, d5Business: 80 },
      entities: [
        { id: 1, type: "event_type", canonicalName: "事故" },
        { id: 2, type: "product", canonicalName: "YJV22 电缆", circle: "C3" },
      ],
    })).toEqual({ alertType: "safety", alertLevel: "L1" });
  });

  it("retains a real project_type-anchored industry safety alert", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { ...zeroScores, d5Business: 75 },
      entities: [
        { id: 1, type: "event_type", canonicalName: "事故" },
        { id: 2, type: "project_type", canonicalName: "海风", circle: "C3" },
      ],
    })).toEqual({ alertType: "safety", alertLevel: "L1" });
  });

  it("does not fire on accident event with no industry subject (T-RR-02 guardrail)", () => {
    expect(computeAlert({
      source: { tier: "T2" },
      scores: { ...zeroScores, d5Business: 75 },
      entities: [{ id: 1, type: "event_type", canonicalName: "事故" }],
    })).toEqual({});
  });

  it("does not fire on high d4/d5 alone", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { ...zeroScores, d4Tech: 90, d5Business: 90 },
      entities: [],
    })).toEqual({});
  });

  it("does not fire when accident event has d5 < 70", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { ...zeroScores, d5Business: 65 },
      entities: [
        { id: 1, type: "event_type", canonicalName: "事故" },
        { id: 2, type: "company", canonicalName: "某电缆厂", circle: "C3" },
      ],
    })).toEqual({});
  });
});

describe("computeAlert policy", () => {
  it("requires NER policy entity and d1Policy >= 75", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { ...zeroScores, d1Policy: 80 },
      entities: [{ id: 1, type: "policy", canonicalName: "GB/T 12706" }],
    })).toEqual({ alertType: "policy", alertLevel: "L1" });
  });

  it("does not fire on category or d1 alone", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { ...zeroScores, d1Policy: 90 },
      entities: [],
      category: "政策与标准",
    })).toEqual({});
  });

  it("does not fire when policy entity has d1 < 75", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { ...zeroScores, d1Policy: 70 },
      entities: [{ id: 1, type: "policy", canonicalName: "发改能源〔2024〕12号" }],
    })).toEqual({});
  });
});

describe("computeAlert risk type (企业风险 sourceCategory)", () => {
  it("emits own alert for Far East entity under 企业风险 (first branch takes priority)", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { d1Policy: 0, d2Chain: 70, d3Market: 0, d4Tech: 0, d5Business: 0 },
      entities: [{ id: 1, type: "company", canonicalName: "远东控股", circle: "C1" }],
      title: "某企业风险动态",
      sourceCategory: "企业风险",
    })).toEqual({ alertType: "own", alertLevel: "L1" });
  });

  it("emits risk alert for C2 entity under 企业风险 without own company", () => {
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

describe("computeAlert safety vs policy precedence (T5, Finding #5)", () => {
  // design §11.1 / requirements §9.1 规定 own → safety → policy。
  // 此前 policy 分支物理先于 safety 求值，同时命中两者的条目被误判为 policy。已修复顺序。
  // T-RR-02：safety 命中还需至少一个 industry subject entity，否则按 policy 处理。
  it("emits safety when both accident and policy conditions hit AND an industry subject is present (safety before policy)", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { d1Policy: 80, d2Chain: 0, d3Market: 0, d4Tech: 0, d5Business: 75 },
      entities: [
        { id: 1, type: "event_type", canonicalName: "事故" },
        { id: 2, type: "policy", canonicalName: "GB/T 12706" },
        { id: 3, type: "company", canonicalName: "某电缆厂", circle: "C3" },
      ],
    })).toEqual({ alertType: "safety", alertLevel: "L1" });
  });

  it("falls through to policy when accident has no industry subject (T-RR-02 guardrail)", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { d1Policy: 80, d2Chain: 0, d3Market: 0, d4Tech: 0, d5Business: 75 },
      entities: [
        { id: 1, type: "event_type", canonicalName: "事故" },
        { id: 2, type: "policy", canonicalName: "GB/T 12706" },
      ],
    })).toEqual({ alertType: "policy", alertLevel: "L1" });
  });

  it("still emits policy when only policy conditions hit (no accident entity)", () => {
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { d1Policy: 80, d2Chain: 0, d3Market: 0, d4Tech: 0, d5Business: 75 },
      entities: [{ id: 2, type: "policy", canonicalName: "GB/T 12706" }],
    })).toEqual({ alertType: "policy", alertLevel: "L1" });
  });

  it("T-RR-02: own / legal / risk branches remain byte-identical for entities that share the alertType IS NOT NULL exemption", () => {
    // own: Far East synonym with high D2 → own (unaffected by T-RR-02).
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { ...zeroScores, d2Chain: 90 },
      entities: [{ id: 1, type: "company", canonicalName: "远东控股", circle: "C1" }],
    })).toEqual({ alertType: "own", alertLevel: "L1" });

    // legal: litigation source + C2 competitor.
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { ...zeroScores, d2Chain: 70 },
      entities: [{ id: 2, type: "company", canonicalName: "亨通光电", circle: "C2" }],
      title: "关于收到民事判决书的公告",
      sourceCategory: LITIGATION_SOURCE_CATEGORY,
    })).toEqual({ alertType: "legal", alertLevel: "L2" });

    // risk: 企业风险 + C2 competitor.
    expect(computeAlert({
      source: { tier: "T2" },
      scores: { ...zeroScores, d2Chain: 60 },
      entities: [{ id: 2, type: "company", canonicalName: "亨通光电", circle: "C2" }],
      title: "某企业风险动态",
      sourceCategory: "企业风险",
    })).toEqual({ alertType: "risk", alertLevel: "L2" });
  });
});

describe("alertLevelFromTier", () => {
  it("maps T1/T2/T3 to L1/L2/L3", () => {
    expect(alertLevelFromTier("T1")).toBe("L1");
    expect(alertLevelFromTier("T2")).toBe("L2");
    expect(alertLevelFromTier("T3")).toBe("L3");
  });
});
