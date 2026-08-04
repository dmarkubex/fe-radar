import { describe, expect, it } from "vitest";
import { PREFILTER_SYSTEM_PROMPT } from "../prompts/prefilter";
import { SCORING_SYSTEM_PROMPT } from "../prompts/scoring";

describe("prompt contracts", () => {
  it("defines independent 0-100 scoring rubrics without tier or circle inflation", () => {
    expect(SCORING_SYSTEM_PROMPT).toContain("0=无相关证据");
    expect(SCORING_SYSTEM_PROMPT).toContain("20=仅提及或背景信息");
    expect(SCORING_SYSTEM_PROMPT).toContain("40=有明确相关事实但影响有限");
    expect(SCORING_SYSTEM_PROMPT).toContain("60=有具体措施、数据或事件且影响明确");
    expect(SCORING_SYSTEM_PROMPT).toContain("80=重大变化并直接影响行业决策");
    expect(SCORING_SYSTEM_PROMPT).toContain("100=已发生且具有全国性、系统性或极端重大影响");
    expect(SCORING_SYSTEM_PROMPT).toContain("分别基于原文证据独立评分");
    expect(SCORING_SYSTEM_PROMPT).toContain("T1/T2/T3");
    expect(SCORING_SYSTEM_PROMPT).toContain("C1/C2/C3");
    expect(SCORING_SYSTEM_PROMPT).toContain("D2_chain 由代码计算");
  });

  it("keeps data-center power and industry tenders inside the prefilter scope", () => {
    for (const term of [
      "BBU",
      "UPS",
      "HVDC",
      "数据中心供配电",
      "海底电缆",
      "框架集采",
      "资格预审",
      "data center power",
      "tender",
      "procurement"
    ]) {
      expect(PREFILTER_SYSTEM_PROMPT).toContain(term);
    }
  });
});
