import type { AlertLevel, SourceTier } from "@fe-radar/shared";
import type { AlertInput, AlertResult, EntityHit } from "./types";
import { hasCompetitorCircle, isLitigationSourceCategory } from "./litigation";
import { isOwnCompanyEntity } from "./priority";
import { isRelevantRiskResult, isRiskSearchSourceCategory } from "./risk-search";

function cleanKeywords(value: string[] | undefined): readonly string[] {
  const cleaned = value?.map((k) => k.trim()).filter((k) => k.length > 0);
  return cleaned && cleaned.length > 0 ? cleaned : [];
}

/** design §11.1 / requirements §9.2：告警等级按信源 tier */
export function alertLevelFromTier(tier: SourceTier): AlertLevel {
  if (tier === "T1") return "L1";
  if (tier === "T2") return "L2";
  return "L3";
}

function hasAccidentEvent(entities: EntityHit[]): boolean {
  return entities.some(
    (e) => e.type === "event_type" && e.canonicalName === "事故"
  );
}

function hasPolicyEntity(entities: EntityHit[]): boolean {
  return entities.some((e) => e.type === "policy");
}

export function computeAlert(input: AlertInput): AlertResult {
  // 1. 自家公司（仅远东同义词组，不是整个 C1）
  if (input.entities.some((entity) => isOwnCompanyEntity(entity, input.ownCompanyProfile))) {
    return { alertType: "own", alertLevel: alertLevelFromTier(input.source.tier) };
  }

  // 1b. 风险检索命中远东关键词 → own（扩展通道，仍走单一入口）
  if (isRiskSearchSourceCategory(input.sourceCategory) && input.title) {
    const riskEntityKeywords = cleanKeywords(input.riskEntityKeywords);
    const riskKeywords = cleanKeywords(input.riskKeywords);
    if (
      riskEntityKeywords.length > 0 &&
      riskKeywords.length > 0 &&
      isRelevantRiskResult(input.title, input.content ?? "", riskEntityKeywords, riskKeywords)
    ) {
      return { alertType: "own", alertLevel: alertLevelFromTier(input.source.tier) };
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

  // 2. 安全事故：event_type=事故 + D5 ≥ 70（design §11.1 / requirements §9.1）
  //    顺序必须在 policy 之前：同时命中事故+政策的条目应判 safety（更紧急）。
  //    2026-07-13 对抗评审 Finding #5：此前 policy 分支先于此求值导致顺序写反。
  if (hasAccidentEvent(input.entities) && input.scores.d5Business >= 70) {
    return { alertType: "safety", alertLevel: alertLevelFromTier(input.source.tier) };
  }

  // 3. 政策：NER policy 类型 + D1 ≥ 75（requirements §9.1）
  if (hasPolicyEntity(input.entities) && input.scores.d1Policy >= 75) {
    return { alertType: "policy", alertLevel: alertLevelFromTier(input.source.tier) };
  }

  return {};
}
