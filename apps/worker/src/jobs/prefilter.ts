import { PREFILTER_SYSTEM_PROMPT, prefilterUserPrompt, type IndustryPrefilterResult, type LlmClient } from "@fe-radar/llm";
import { createLogger } from "@fe-radar/shared";

const logger = createLogger({ service: "prefilter" });

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
  } catch (error) {
    logger.warn({ error, title: input.title }, "prefilter primary failed, trying fallback");
    try {
      return (await fallback.chatJson<IndustryPrefilterResult>({
        system: PREFILTER_SYSTEM_PROMPT,
        user: prefilterUserPrompt(input.title, input.content),
        schemaName: "prefilter",
        schema
      })).value;
    } catch (fallbackError) {
      logger.warn({ error: fallbackError, title: input.title }, "prefilter fallback also failed, returning unknown");
      return { isIndustryRelated: "unknown", reason: "prefilter fallback failed" };
    }
  }
}
