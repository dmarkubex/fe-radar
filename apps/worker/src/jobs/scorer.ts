import { LlmError } from "@fe-radar/shared";
import { SCORING_SYSTEM_PROMPT, type LlmClient, type ScoringResult } from "@fe-radar/llm";

export const BLOCKED_SUMMARY = "[需人工脱敏]";

const schema = {
  type: "object",
  properties: {
    d1Policy: { type: "number" },
    d3Market: { type: "number" },
    d4Tech: { type: "number" },
    d5Business: { type: "number" },
    summaryZh: { type: "string" },
    translationZh: { type: "string" },
    category: { enum: ["政策与标准", "市场与价格", "技术与产品", "项目与招投标", "公司与资本"] }
  },
  required: ["d1Policy", "d3Market", "d4Tech", "d5Business", "summaryZh", "translationZh", "category"],
  additionalProperties: false
};

export async function runScorer(text: string, deepSeek: LlmClient): Promise<ScoringResult> {
  try {
    return (await deepSeek.chatJson<ScoringResult>({
      system: SCORING_SYSTEM_PROMPT,
      user: text,
      schemaName: "scoring",
      schema
    })).value;
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
