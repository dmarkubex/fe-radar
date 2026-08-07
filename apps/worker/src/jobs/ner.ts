import { NER_SYSTEM_PROMPT, type LlmClient, type NerEntityResult } from "@fe-radar/llm";
import { createLogger } from "@fe-radar/shared";
import { detectPolicyEntities, type EntityDictionary } from "../lib/entities-dict";

const logger = createLogger({ service: "ner" });
const ACCIDENT_EVENT_PATTERN = /事故|火灾|爆炸|停电|触电|死亡|坍塌|伤亡/;
// Evidence-like policy span: standard number, document number, or a name
// ending in a policy-document term. Generic words (AI / 创新 / 新能源) are
// rejected so they cannot slip through as policy entities.
const POLICY_EVIDENCE_PATTERN =
  /(?:[A-Z]{1,3}\/?(?:T|B)?\s?\d{3,6}(?:-\d{2,4})?|[〔(]\s?\d{2,4}\S*\d{1,4}\s?[〕)]|[一-鿿]{2,30}(?:法|条例|办法|规定|通知|意见|规划|标准|政策))/;

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

/**
 * Trust-boundary validator for LLM-extracted entities.
 *
 * - span (text) must be non-empty AND must literally occur in the input text —
 *   blocks hallucinated entity names like "AI" / "创新" / "新能源" being accepted
 *   as policy entities.
 * - For `event_type`, only canonicalize to "事故" when the **extracted span**
 *   itself contains an existing accident keyword (not when only a
 *   hallucinated `canonicalName` does).
 * - For `policy`, only retain spans that look like evidence: standard number,
 *   document number, or name ending in a policy-document term. Generic words
 *   such as "AI" / "创新" / "新能源" are dropped.
 */
export function validateLlmEntity(
  hit: NerEntityResult["entities"][number],
  text: string
): NerEntityResult["entities"][number] | null {
  const span = typeof hit.text === "string" ? hit.text.trim() : "";
  if (span.length === 0) return null;
  if (!text.includes(span)) return null;

  if (hit.type === "event_type") {
    // Only canonicalize to "事故" when the actual span contains an accident
    // keyword. Drop otherwise (was previously passing through with raw
    // canonicalName, causing false safety alerts).
    if (ACCIDENT_EVENT_PATTERN.test(span)) {
      return { ...hit, text: span, canonicalName: "事故" };
    }
    return null;
  }

  if (hit.type === "policy") {
    // Drop generic policy labels like "AI" / "创新" / "新能源" that don't
    // reference an actual standard, document number, or policy name.
    if (POLICY_EVIDENCE_PATTERN.test(span)) return { ...hit, text: span };
    return null;
  }

  return { ...hit, text: span };
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
  const policyHits = detectPolicyEntities(text).map((hit) => ({
    type: hit.type,
    text: hit.span,
    canonicalName: hit.canonicalName,
  }));
  const llmHits = (await callNerLlm(text, qwen, fallback))
    .map((hit) => validateLlmEntity(hit, text))
    .filter((hit): hit is NerEntityResult["entities"][number] => hit !== null);
  return { entities: [...dictHits, ...policyHits, ...llmHits] };
}