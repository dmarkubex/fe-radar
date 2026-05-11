import { PREFILTER_SYSTEM_PROMPT, prefilterUserPrompt, type IndustryPrefilterResult, type LlmClient } from "@fe-radar/llm";

export interface PrefilterInput {
  title: string;
  content: string;
}

const schema = {
  type: "object",
  properties: {
    isIndustryRelated: { anyOf: [{ type: "boolean" }, { const: "unknown" }] },
    reason: { type: "string" }
  },
  required: ["isIndustryRelated", "reason"],
  additionalProperties: false
};

export async function runPrefilter(input: PrefilterInput, qwen: LlmClient, fallback: LlmClient): Promise<IndustryPrefilterResult> {
  try {
    return (await qwen.chatJson<IndustryPrefilterResult>({
      system: PREFILTER_SYSTEM_PROMPT,
      user: prefilterUserPrompt(input.title, input.content),
      schemaName: "prefilter",
      schema
    })).value;
  } catch {
    try {
      return (await fallback.chatJson<IndustryPrefilterResult>({
        system: PREFILTER_SYSTEM_PROMPT,
        user: prefilterUserPrompt(input.title, input.content),
        schemaName: "prefilter",
        schema
      })).value;
    } catch {
      return { isIndustryRelated: "unknown", reason: "prefilter fallback failed" };
    }
  }
}
