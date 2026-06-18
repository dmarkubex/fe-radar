import { NER_SYSTEM_PROMPT, type LlmClient, type NerEntityResult } from "@fe-radar/llm";
import { createLogger } from "@fe-radar/shared";
import { detectPolicyEntities, type EntityDictionary } from "../lib/entities-dict";

const logger = createLogger({ service: "ner" });

const schema = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { enum: ["company", "product", "policy", "region", "money", "event_type", "project_type"] },
          text: { type: "string" },
          canonicalName: { type: "string" }
        },
        required: ["type", "text"],
        additionalProperties: false
      }
    }
  },
  required: ["entities"],
  additionalProperties: false
};

async function callNerLlm(text: string, qwen: LlmClient, fallback: LlmClient): Promise<NerEntityResult["entities"]> {
  const request = {
    system: NER_SYSTEM_PROMPT,
    user: text,
    schemaName: "ner",
    schema,
  } as const;

  try {
    return (await qwen.chatJson<NerEntityResult>(request)).value.entities;
  } catch (error) {
    logger.warn({ error }, "ner primary failed, trying fallback");
    try {
      return (await fallback.chatJson<NerEntityResult>(request)).value.entities;
    } catch (fallbackError) {
      logger.warn({ error: fallbackError }, "ner fallback also failed, continuing with dictionary/policy hits only");
      return [];
    }
  }
}

export async function runNer(
  text: string,
  dictionary: EntityDictionary,
  qwen: LlmClient,
  fallback: LlmClient,
): Promise<NerEntityResult> {
  const dictHits = dictionary.match(text).map((hit) => ({
    type: hit.type as NerEntityResult["entities"][number]["type"],
    text: hit.span,
    canonicalName: hit.canonicalName
  }));
  const policyHits = detectPolicyEntities(text).map((hit) => ({ type: hit.type, text: hit.span }));
  const llmHits = await callNerLlm(text, qwen, fallback);
  return { entities: [...dictHits, ...policyHits, ...llmHits] };
}
