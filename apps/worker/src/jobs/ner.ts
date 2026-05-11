import { NER_SYSTEM_PROMPT, type LlmClient, type NerEntityResult } from "@fe-radar/llm";
import { detectPolicyEntities, type EntityDictionary } from "../lib/entities-dict";

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

export async function runNer(text: string, dictionary: EntityDictionary, llm: LlmClient): Promise<NerEntityResult> {
  const dictHits = dictionary.match(text).map((hit) => ({
    type: hit.type as NerEntityResult["entities"][number]["type"],
    text: hit.span,
    canonicalName: hit.canonicalName
  }));
  const policyHits = detectPolicyEntities(text).map((hit) => ({ type: hit.type, text: hit.span }));
  const llmHits = (await llm.chatJson<NerEntityResult>({
    system: NER_SYSTEM_PROMPT,
    user: text,
    schemaName: "ner",
    schema
  })).value.entities;
  return { entities: [...dictHits, ...policyHits, ...llmHits] };
}
