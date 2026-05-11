import type { AlertLevel, AlertType, Circle, QuotaState, SourceTier } from "@fe-radar/shared";

export interface EntityHit {
  id: number;
  type: string;
  canonicalName: string;
  circle?: Circle | null;
}

export interface SourceSignal {
  tier: SourceTier;
}

export interface ScoreAtoms {
  d1Policy: number;
  d2Chain: number;
  d3Market: number;
  d4Tech: number;
  d5Business: number;
}

export interface ThresholdConfig {
  [category: string]: Partial<Record<Circle, number>>;
}

export interface ScoringConfig {
  weights: {
    w1: number;
    w2: number;
    w3: number;
    w4: number;
    w5: number;
  };
  tCoef: Record<SourceTier, number>;
  cCoef: Record<Circle, number>;
  thresholds?: ThresholdConfig;
}

export interface QualityScoreResult extends ScoreAtoms {
  qualityScore: number;
  topCircle: Circle;
}

export interface QuotaInput {
  itemId: number;
  isPriority: boolean;
  businessDate: string;
}

export interface QuotaDecision {
  state: QuotaState;
  counterKey?: string;
}

export interface AlertInput {
  source: SourceSignal;
  scores: ScoreAtoms;
  entities: EntityHit[];
  category?: string;
}

export interface AlertResult {
  alertType?: AlertType;
  alertLevel?: AlertLevel;
}

export interface ClusterInput {
  itemId: number;
  embedding: number[];
  candidates?: ClusterCandidate[];
}

export interface ClusterCandidate {
  clusterId: number;
  centroid: number[];
}

export interface ClusterDecision {
  clusterId: number;
  similarity: number;
  shouldCreate: boolean;
}

export interface CuratorInput {
  atoms: Omit<ScoreAtoms, "d2Chain">;
  source: SourceSignal;
  entities: EntityHit[];
  config: ScoringConfig;
  category: string;
}

export interface CuratorResult extends QualityScoreResult {
  alertType?: AlertType;
  alertLevel?: AlertLevel;
  isCurated: boolean;
}
