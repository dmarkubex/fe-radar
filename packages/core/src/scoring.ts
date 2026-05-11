import { NotImplementedError } from "@fe-radar/shared";
import type { EntityHit, QualityScoreResult, ScoreAtoms, ScoringConfig, SourceSignal } from "./types";

export function computeD2Chain(entities: EntityHit[]): number {
  void entities;
  throw new NotImplementedError("computeD2Chain");
}

export function computeQualityScore(
  atoms: ScoreAtoms,
  source: SourceSignal,
  entities: EntityHit[],
  config: ScoringConfig
): QualityScoreResult {
  void atoms;
  void source;
  void entities;
  void config;
  throw new NotImplementedError("computeQualityScore");
}
