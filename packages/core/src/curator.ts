import { computeAlert } from "./alert";
import { computeD2Chain, computeQualityScore } from "./scoring";
import type { CuratorInput, CuratorResult, ScoreAtoms } from "./types";

export function curateItem(input: CuratorInput): CuratorResult {
  const atoms: ScoreAtoms = {
    ...input.atoms,
    d2Chain: computeD2Chain(input.entities)
  };
  const score = computeQualityScore(atoms, input.source, input.entities, input.config);
  const alert = computeAlert({
    source: input.source,
    scores: score,
    entities: input.entities,
    category: input.category,
    title: input.title,
    content: input.content,
    sourceCategory: input.sourceCategory,
    riskEntityKeywords: input.riskEntityKeywords,
    riskKeywords: input.riskKeywords,
    ownCompanyProfile: input.ownCompanyProfile,
  });
  const threshold = input.config.thresholds?.[input.category]?.[score.topCircle] ?? 70;

  return {
    ...score,
    ...alert,
    isCurated: score.qualityScore >= threshold || alert.alertType === "own" || alert.alertType === "legal"
  };
}
