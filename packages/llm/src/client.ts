import OpenAI from "openai";
import pino from "pino";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { LlmError } from "@fe-radar/shared";
import type { EmbeddingRequest, JsonSchemaRequest, LlmClient, LlmResult } from "./types";

const logger = pino({ name: "fe-radar-llm" });

export interface OpenAiCompatibleOptions {
  provider: string;
  apiKey: string;
  baseURL: string;
  model: string;
  embeddingModel?: string;
  inputTokenCostCny?: number;
  outputTokenCostCny?: number;
}

export class OpenAiCompatibleClient implements LlmClient {
  private readonly client: OpenAI;

  public constructor(private readonly options: OpenAiCompatibleOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
  }

  public async chatJson<T>(request: JsonSchemaRequest): Promise<LlmResult<T>> {
    const startedAt = Date.now();
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const params: ChatCompletionCreateParamsNonStreaming = {
          model: this.options.model,
          temperature: request.temperature ?? 0.2,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: request.schemaName,
              strict: true,
              schema: request.schema
            }
          }
        };
        const response = await this.client.chat.completions.create(params);
        const content = response.choices[0]?.message.content;
        if (!content) {
          throw new LlmError("LLM_EMPTY", "LLM returned empty content");
        }
        const value = JSON.parse(content) as T;
        const usage = this.usage(response.usage?.prompt_tokens ?? 0, response.usage?.completion_tokens ?? 0);
        logger.info({ provider: this.options.provider, tokens: usage, latencyMs: Date.now() - startedAt }, "llm chat_json complete");
        return { value, usage, provider: this.options.provider };
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          logger.warn({ provider: this.options.provider, attempt: attempt + 1, error }, "llm chat_json attempt failed, retrying");
        }
      }
    }

    throw new LlmError("LLM_JSON_INVALID", "LLM JSON schema request failed after retries", { cause: lastError });
  }

  public async embedding(request: EmbeddingRequest): Promise<LlmResult<number[]>> {
    const startedAt = Date.now();
    const response = await this.client.embeddings.create({
      model: this.options.embeddingModel ?? this.options.model,
      input: request.input
    });
    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new LlmError("LLM_EMBEDDING_EMPTY", "LLM returned empty embedding");
    }
    const usage = this.usage(response.usage?.prompt_tokens ?? 0, 0);
    logger.info({ provider: this.options.provider, tokens: usage, latencyMs: Date.now() - startedAt }, "llm embedding complete");
    return { value: embedding, usage, provider: this.options.provider };
  }

  private usage(inputTokens: number, outputTokens: number) {
    const costCny =
      inputTokens * (this.options.inputTokenCostCny ?? 0) +
      outputTokens * (this.options.outputTokenCostCny ?? 0);
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costCny
    };
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new LlmError("LLM_CONFIG", `${name} is required`);
  }
  return value;
}
