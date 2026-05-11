import type { EntityHit, QualityScoreResult, ScoreAtoms, ScoringConfig, SourceSignal } from "./types";

const CIRCLE_RANK = { C1: 3, C2: 2, C3: 1 } as const;

export function computeD2Chain(entities: EntityHit[]): number {
  const circles = entities.map((entity) => entity.circle).filter((circle): circle is "C1" | "C2" | "C3" => circle === "C1" || circle === "C2" || circle === "C3");
  if (circles.length === 0) {
    return 0;
  }

  const topCircle = pickTopCircle(entities);
  const base = topCircle === "C1" ? 90 : topCircle === "C2" ? 65 : 40;
  return clampScore(base + Math.min(10, circles.length * 2));
}

export function computeQualityScore(
  atoms: ScoreAtoms,
  source: SourceSignal,
  entities: EntityHit[],
  config: ScoringConfig
): QualityScoreResult {
  const topCircle = pickTopCircle(entities);
  const weighted =
    atoms.d1Policy * config.weights.w1 +
    atoms.d2Chain * config.weights.w2 +
    atoms.d3Market * config.weights.w3 +
    atoms.d4Tech * config.weights.w4 +
    atoms.d5Business * config.weights.w5;
  const qualityScore = clampScore(weighted * config.tCoef[source.tier] * config.cCoef[topCircle]);

  return {
    ...atoms,
    topCircle,
    qualityScore
  };
}

export function pickTopCircle(entities: EntityHit[]): "C1" | "C2" | "C3" {
  return entities.reduce<"C1" | "C2" | "C3">((best, entity) => {
    const circle = entity.circle;
    if (circle === "C1" || circle === "C2" || circle === "C3") {
      return CIRCLE_RANK[circle] > CIRCLE_RANK[best] ? circle : best;
    }
    return best;
  }, "C3");
}

export function clampScore(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}
