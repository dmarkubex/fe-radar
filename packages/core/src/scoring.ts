import type { EntityFinancialSnapshot, EntityHit, QualityScoreResult, ScoreAtoms, ScoringConfig, SourceSignal } from "./types";

export const CIRCLE_RANK = { C1: 3, C2: 2, C3: 1 } as const;

export function computeD2Chain(entities: EntityHit[]): number {
  if (entities.some((entity) => entity.circle === "C1")) return 95;

  const c2Count = new Set(entities.filter((entity) => entity.circle === "C2").map((entity) => entity.id)).size;
  if (c2Count >= 2) return 80;
  if (c2Count === 1) return 70;
  if (entities.some((entity) => entity.circle === "C3")) return 50;
  return 20;
}

export function computeD3Market(financials: EntityFinancialSnapshot[]): number | null {
  if (financials.length === 0) {
    return null;
  }

  const roe = findLatestMetric(financials, "roe");
  const revenueGrowth = findLatestMetric(financials, "revenue_growth");
  const netProfitGrowth = findLatestMetric(financials, "net_profit_growth");

  if (roe === undefined && revenueGrowth === undefined && netProfitGrowth === undefined) {
    return null;
  }

  let score = 50;

  if (roe !== undefined) {
    if (roe > 15) score += 20;
    else if (roe >= 10) score += 10;
    else if (roe < 0) score -= 20;
  }
  if (revenueGrowth !== undefined) {
    if (revenueGrowth > 20) score += 15;
    else if (revenueGrowth >= 10) score += 8;
    else if (revenueGrowth < 0) score -= 15;
  }
  if (netProfitGrowth !== undefined) {
    if (netProfitGrowth > 20) score += 15;
    else if (netProfitGrowth >= 10) score += 8;
    else if (netProfitGrowth < 0) score -= 15;
  }

  return clampScore(score);
}

function findLatestMetric(financials: EntityFinancialSnapshot[], metric: string): number | undefined {
  const matches = financials.filter((f) => f.metric.toLowerCase() === metric.toLowerCase());
  if (matches.length === 0) {
    return undefined;
  }
  matches.sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0));
  return matches[0]?.value;
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
