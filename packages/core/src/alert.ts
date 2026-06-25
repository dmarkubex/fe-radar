import type { AlertInput, AlertResult } from "./types";
import { hasCompetitorCircle, isLitigationSourceCategory } from "./litigation";
import { isRelevantRiskResult, isRiskSearchSourceCategory } from "./risk-search";

function cleanKeywords(value: string[] | undefined): readonly string[] {
  const cleaned = value?.map((k) => k.trim()).filter((k) => k.length > 0);
  return cleaned && cleaned.length > 0 ? cleaned : [];
}

export function computeAlert(input: AlertInput): AlertResult {
  if (input.entities.some((entity) => entity.circle === "C1")) {
    return { alertType: "own", alertLevel: input.scores.d2Chain >= 90 ? "L1" : "L2" };
  }

  if (isRiskSearchSourceCategory(input.sourceCategory) && input.title) {
    const riskEntityKeywords = cleanKeywords(input.riskEntityKeywords);
    const riskKeywords = cleanKeywords(input.riskKeywords);
    if (
      riskEntityKeywords.length > 0 &&
      riskKeywords.length > 0 &&
      isRelevantRiskResult(input.title, input.content ?? "", riskEntityKeywords, riskKeywords)
    ) {
      return { alertType: "own", alertLevel: "L2" };
    }
  }

  if (isLitigationSourceCategory(input.sourceCategory) && hasCompetitorCircle(input.entities)) {
    return {
      alertType: "legal",
      alertLevel: input.source.tier === "T1" ? "L2" : "L3",
    };
  }

  if (input.sourceCategory === "企业风险" && hasCompetitorCircle(input.entities)) {
    return { alertType: "risk", alertLevel: "L2" };
  }

  if (input.category === "政策与标准" || input.scores.d1Policy >= 80) {
    return { alertType: "policy", alertLevel: input.source.tier === "T1" ? "L1" : "L2" };
  }

  if (input.scores.d4Tech >= 85 || input.scores.d5Business >= 85) {
    return { alertType: "safety", alertLevel: "L3" };
  }

  return {};
}
