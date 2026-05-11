export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCny?: number;
}

export interface LlmResult<T> {
  value: T;
  usage: LlmUsage;
  provider: string;
}

export interface JsonSchemaRequest {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  temperature?: number;
}

export interface EmbeddingRequest {
  input: string;
}

export interface LlmClient {
  chatJson<T>(request: JsonSchemaRequest): Promise<LlmResult<T>>;
  embedding(request: EmbeddingRequest): Promise<LlmResult<number[]>>;
}

export interface IndustryPrefilterResult {
  isIndustryRelated: boolean | "unknown";
  reason: string;
}

export interface NerEntityResult {
  entities: Array<{
    type: "company" | "product" | "policy" | "region" | "money" | "event_type" | "project_type";
    text: string;
    canonicalName?: string;
  }>;
}

export interface ScoringResult {
  d1Policy: number;
  d3Market: number;
  d4Tech: number;
  d5Business: number;
  summaryZh: string;
  translationZh: string;
  category: "政策与标准" | "市场与价格" | "技术与产品" | "项目与招投标" | "公司与资本";
}

export interface DailyReportResult {
  sections: Record<string, string>;
}
