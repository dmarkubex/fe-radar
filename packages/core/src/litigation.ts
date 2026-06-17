export const LITIGATION_SOURCE_CATEGORY = "上市公司涉诉";

export function hasCompetitorCircle(entities: Array<{ circle?: string | null }>): boolean {
  return entities.some((entity) => entity.circle === "C2");
}

export function isLitigationSourceCategory(sourceCategory?: string | null): boolean {
  return sourceCategory?.trim() === LITIGATION_SOURCE_CATEGORY;
}
