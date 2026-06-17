import { describe, expect, it } from "vitest";
import { computeAlert } from "../alert";
import { isRelevantRiskResult, RISK_SEARCH_SOURCE_CATEGORY } from "../risk-search";

const c1Keywords = ["远东控股", "远东电缆"];
const riskKeywords = ["行政处罚", "罚款", "抽检"];

describe("risk-search helpers", () => {
  it("matches relevant C1 risk results", () => {
    expect(isRelevantRiskResult("远东电缆行政处罚", "市场监管局罚款", c1Keywords, riskKeywords)).toBe(true);
    expect(isRelevantRiskResult("远东控股业绩说明", "平稳增长", c1Keywords, riskKeywords)).toBe(false);
  });
});

describe("computeAlert risk search", () => {
  it("emits own alert for risk search hits about C1", () => {
    expect(computeAlert({
      source: { tier: "T2" },
      scores: { d1Policy: 0, d2Chain: 40, d3Market: 0, d4Tech: 0, d5Business: 50 },
      entities: [],
      title: "远东控股收到行政处罚告知书",
      content: "涉及产品质量抽检不合格",
      sourceCategory: RISK_SEARCH_SOURCE_CATEGORY,
      riskEntityKeywords: c1Keywords,
      riskKeywords,
    })).toEqual({ alertType: "own", alertLevel: "L2" });
  });

  it("does not use code fallback keywords when source config omits them", () => {
    expect(computeAlert({
      source: { tier: "T2" },
      scores: { d1Policy: 0, d2Chain: 40, d3Market: 0, d4Tech: 0, d5Business: 50 },
      entities: [],
      title: "远东控股收到行政处罚告知书",
      content: "涉及产品质量抽检不合格",
      sourceCategory: RISK_SEARCH_SOURCE_CATEGORY,
    })).toEqual({});
  });

  it("uses source-configured keywords instead of broad defaults", () => {
    expect(computeAlert({
      source: { tier: "T2" },
      scores: { d1Policy: 0, d2Chain: 40, d3Market: 0, d4Tech: 0, d5Business: 50 },
      entities: [],
      title: "远东控股收到行政处罚告知书",
      content: "涉及产品质量抽检不合格",
      sourceCategory: RISK_SEARCH_SOURCE_CATEGORY,
      riskEntityKeywords: ["其他公司"],
      riskKeywords: ["其他风险"],
    })).toEqual({});
  });
});
