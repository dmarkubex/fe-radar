import { LlmError } from "@fe-radar/shared";
import {
  SCORING_SYSTEM_PROMPT,
  type LlmClient,
  type ScoringResult
} from "@fe-radar/llm";

export const BLOCKED_SUMMARY = "[需人工脱敏]";

const schema = {
  type: "object",
  properties: {
    d1Policy: { type: "number", minimum: 0, maximum: 100 },
    d3Market: { type: "number", minimum: 0, maximum: 100 },
    d4Tech: { type: "number", minimum: 0, maximum: 100 },
    d5Business: { type: "number", minimum: 0, maximum: 100 },
    summaryZh: { type: "string" },
    translationZh: { type: "string" },
    category: {
      enum: [
        "政策与标准",
        "市场与价格",
        "技术与产品",
        "项目与招投标",
        "公司与资本"
      ]
    }
  },
  required: [
    "d1Policy",
    "d3Market",
    "d4Tech",
    "d5Business",
    "summaryZh",
    "translationZh",
    "category"
  ],
  additionalProperties: false
};

export async function runScorer(
  text: string,
  deepSeek: LlmClient
): Promise<ScoringResult> {
  try {
    const result = (
      await deepSeek.chatJson<ScoringResult>({
        system: SCORING_SYSTEM_PROMPT,
        user: text,
        schemaName: "scoring",
        schema,
        temperature: 0
      })
    ).value;
    return normalizeScoringResult(result);
  } catch (error) {
    if (error instanceof LlmError && error.code === "SCRUBBER_BLOCKED") {
      return {
        d1Policy: 0,
        d3Market: 0,
        d4Tech: 0,
        d5Business: 0,
        summaryZh: BLOCKED_SUMMARY,
        translationZh: BLOCKED_SUMMARY,
        category: "公司与资本"
      };
    }
    throw error;
  }
}

export function normalizeScoringResult(result: ScoringResult): ScoringResult {
  return {
    ...result,
    d1Policy: clampScore(result.d1Policy),
    d3Market: clampScore(result.d3Market),
    d4Tech: clampScore(result.d4Tech),
    d5Business: clampScore(result.d5Business)
  };
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}
