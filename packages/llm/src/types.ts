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

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** role=tool 必填 */
  tool_call_id?: string;
  /** assistant 发起工具 */
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
}

export interface ChatToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type ChatStreamDelta =
  | { type: "token"; data: string }
  | { type: "tool_call"; data: { id: string; name: string; arguments: string } }
  | { type: "usage"; data: LlmUsage }
  | { type: "done" };

export interface ChatStreamRequest {
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  /** agentscope 上下文压缩触发的合成工具调用选择（OpenAI 兼容 named-function 形状）。worker /internal/llm 原样转发。 */
  tool_choice?: ChatToolChoiceParam;
  temperature?: number;
  /** worker /internal/llm 必须透传到 create(..., { signal })；scrubber 原样转发，不得丢掉 */
  signal?: AbortSignal;
}

/** OpenAI 兼容的 tool_choice 形状。subagent named function 形式由 agentscope `ToolChoice(mode="<tool_name>")` 触发，本接口对应其 wire 形状。 */
export type ChatToolChoiceParam =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

export interface LlmClient {
  chatJson<T>(request: JsonSchemaRequest): Promise<LlmResult<T>>;
  embedding(request: EmbeddingRequest): Promise<LlmResult<number[]>>;
  chatStream(request: ChatStreamRequest): AsyncIterable<ChatStreamDelta>;
}

export interface IndustryPrefilterResult {
  isIndustryRelated: boolean | "unknown";
  reason: string;
}

export interface NerEntityResult {
  entities: Array<{
    type:
      | "company"
      | "product"
      | "policy"
      | "region"
      | "money"
      | "event_type"
      | "project_type";
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
  category:
    | "政策与标准"
    | "市场与价格"
    | "技术与产品"
    | "项目与招投标"
    | "公司与资本";
}

export interface DailyReportResult {
  sections: Record<string, string>;
}
