export const RISK_SEARCH_SOURCE_CATEGORY = "风险检索";

export function isRiskSearchSourceCategory(sourceCategory?: string | null): boolean {
  return sourceCategory?.trim() === RISK_SEARCH_SOURCE_CATEGORY;
}

export function matchesC1Keywords(text: string, keywords: readonly string[]): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  return keywords.some((keyword) => normalized.includes(keyword));
}

export function matchesRiskKeywords(text: string, keywords: readonly string[]): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  return keywords.some((keyword) => normalized.includes(keyword));
}

export function isRelevantRiskResult(
  title: string,
  description: string,
  entityKeywords: readonly string[],
  riskKeywords: readonly string[]
): boolean {
  const combined = `${title}\n${description}`;
  return matchesC1Keywords(combined, entityKeywords) && matchesRiskKeywords(combined, riskKeywords);
}
