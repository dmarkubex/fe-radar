import type { AlertLevel, AlertType, Circle, QuotaState, SourceTier } from "@fe-radar/shared";

export interface EntityHit {
  id: number;
  type: string;
  canonicalName: string;
  circle?: Circle | null;
}

/**
 * 本公司判定集合（注入式）：由 worker 侧从 DB entities 构造后注入，core 仅做精确等值。
 * 定义在 types.ts（而非 priority.ts）以避免 priority↔types 循环 import。
 */
export interface OwnCompanyProfile {
  /** 精确等值集合（canonicalName + aliases），不含子串兜底 */
  readonly names: ReadonlySet<string>;
}

export interface EntityFinancialSnapshot {
  metric: string;
  value: number;
  period: string;
}

// P0-1: 财务指标标准键名（英文，落库 metric 列统一用这些值）
export const FINANCIAL_METRICS = {
  ROE: "roe",
  NET_PROFIT: "net_profit",
  REVENUE: "revenue",
  REVENUE_GROWTH: "revenue_growth",
  NET_PROFIT_GROWTH: "net_profit_growth",
} as const;

/** dataPro 返回的中文字段名 → 标准英文 metric 键（防写入/读取漂移） */
export const DATAPRO_METRIC_KEY_MAP: Record<string, string> = {
  ROE: FINANCIAL_METRICS.ROE,
  "净利润": FINANCIAL_METRICS.NET_PROFIT,
  "营收": FINANCIAL_METRICS.REVENUE,
  "营收增速": FINANCIAL_METRICS.REVENUE_GROWTH,
  "净利润增速": FINANCIAL_METRICS.NET_PROFIT_GROWTH,
};

/** computeD3Market 所需的 metric 键列表（scorer 查询用） */
export const D3_METRIC_KEYS = [
  FINANCIAL_METRICS.ROE,
  FINANCIAL_METRICS.REVENUE_GROWTH,
  FINANCIAL_METRICS.NET_PROFIT_GROWTH,
];

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
  counterKey: string;
}

export interface AlertInput {
  source: SourceSignal;
  scores: ScoreAtoms;
  entities: EntityHit[];
  category?: string;
  title?: string;
  content?: string;
  sourceCategory?: string | null;
  /** 风险检索关键词（来自 source config）；缺省不触发风险检索告警 */
  riskEntityKeywords?: string[];
  riskKeywords?: string[];
  /**
   * 本公司判定集合（注入式，design §11.1）。由 worker 从 DB entities 构造后注入，
   * core 保持纯函数不依赖 db。缺省时 alert.ts 回退到 DEFAULT_OWN_COMPANY_PROFILE。
   */
  ownCompanyProfile?: OwnCompanyProfile;
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
  title?: string;
  content?: string;
  sourceCategory?: string | null;
  /** 风险检索关键词（来自 source config）；缺省不触发风险检索告警 */
  riskEntityKeywords?: string[];
  riskKeywords?: string[];
  /** 本公司判定集合（注入式，透传给 computeAlert；缺省回退 DEFAULT profile） */
  ownCompanyProfile?: OwnCompanyProfile;
}

export interface CuratorResult extends QualityScoreResult {
  alertType?: AlertType;
  alertLevel?: AlertLevel;
  isCurated: boolean;
}
