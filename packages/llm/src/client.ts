import OpenAI from "openai";
import pino from "pino";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { LlmError } from "@fe-radar/shared";
import type { EmbeddingRequest, JsonSchemaRequest, LlmClient, LlmResult } from "./types";

const logger = pino({ name: "fe-radar-llm" });

/** Strip optional markdown code fences (e.g. ```json … ```) before JSON.parse. */
export function stripMarkdownJsonFence(content: string): string {
  const trimmed = content.trim();
  const closedFence = trimmed.match(/^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i);
  if (closedFence?.[1]) {
    return closedFence[1].trim();
  }

  const openFence = trimmed.match(/^```(?:json)?\s*\r?\n([\s\S]+)$/i);
  if (openFence?.[1]) {
    return openFence[1].replace(/\r?\n?```\s*$/i, "").trim();
  }

  return trimmed;
}

export interface OpenAiCompatibleOptions {
  provider: string;
  apiKey: string;
  baseURL: string;
  model: string;
  embeddingBaseURL?: string;
  embeddingApiKey?: string;
  embeddingModel?: string;
  inputTokenCostCny?: number;
  outputTokenCostCny?: number;
  /**
   * JSON 结构化输出策略：
   * - auto（默认）：优先 json_schema，不支持时降级 json_object 并缓存能力
   * - json_object：直接用 json_object（DeepSeek 等不支持 json_schema 的厂商）
   * - json_schema：仅尝试 json_schema，不降级
   */
  jsonResponseFormat?: "auto" | "json_schema" | "json_object";
}

export class OpenAiCompatibleClient implements LlmClient {
  private readonly client: OpenAI;
  private readonly embeddingClient: OpenAI;
  /** auto 模式下探测到 json_schema 不可用后，后续请求跳过探测 */
  private jsonSchemaCapability: "unknown" | "supported" | "unsupported" = "unknown";

  public constructor(private readonly options: OpenAiCompatibleOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
    this.embeddingClient = new OpenAI({
      apiKey: options.embeddingApiKey ?? options.apiKey,
      baseURL: options.embeddingBaseURL ?? options.baseURL
    });
  }

  public async chatJson<T>(request: JsonSchemaRequest): Promise<LlmResult<T>> {
    const startedAt = Date.now();
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.createChatJsonCompletion(request);
        const content = response.choices[0]?.message.content;
        if (!content) {
          throw new LlmError("LLM_EMPTY", "LLM returned empty content");
        }
        const value = JSON.parse(stripMarkdownJsonFence(content)) as T;
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

  private async createChatJsonCompletion(request: JsonSchemaRequest) {
    const format = this.resolveJsonResponseFormat();
    if (format === "json_object") {
      return this.client.chat.completions.create(this.chatJsonParams(request, "json_object"));
    }

    try {
      const response = await this.client.chat.completions.create(this.chatJsonParams(request, "json_schema"));
      this.jsonSchemaCapability = "supported";
      return response;
    } catch (error) {
      if (!this.isJsonSchemaUnsupported(error)) {
        throw error;
      }

      if (this.options.jsonResponseFormat === "json_schema") {
        throw error;
      }

      this.jsonSchemaCapability = "unsupported";
      logger.info({ provider: this.options.provider }, "llm json_schema unavailable, using json_object");
      return this.client.chat.completions.create(this.chatJsonParams(request, "json_object"));
    }
  }

  private resolveJsonResponseFormat(): "json_schema" | "json_object" {
    if (this.options.jsonResponseFormat === "json_object") {
      return "json_object";
    }
    if (this.options.jsonResponseFormat === "json_schema") {
      return "json_schema";
    }
    if (this.jsonSchemaCapability === "unsupported") {
      return "json_object";
    }
    return "json_schema";
  }

  private chatJsonParams(request: JsonSchemaRequest, responseFormat: "json_schema" | "json_object"): ChatCompletionCreateParamsNonStreaming {
    const system =
      responseFormat === "json_schema"
        ? request.system
        : `${request.system}\n\nReturn one valid JSON object only. It must satisfy this JSON Schema: ${JSON.stringify(request.schema)}`;

    return {
      model: this.options.model,
      temperature: request.temperature ?? 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: request.user }
      ],
      response_format:
        responseFormat === "json_schema"
          ? {
              type: "json_schema",
              json_schema: {
                name: request.schemaName,
                strict: true,
                schema: request.schema
              }
            }
          : { type: "json_object" }
    };
  }

  private isJsonSchemaUnsupported(error: unknown): boolean {
    const messages: string[] = [];
    if (error instanceof Error) {
      messages.push(error.message);
    }
    const nested = (error as { error?: { message?: string } })?.error?.message;
    if (nested) {
      messages.push(nested);
    }
    const text = messages.join(" ");
    return text.includes("response_format") && (text.includes("unavailable") || text.includes("unsupported"));
  }

  public async embedding(request: EmbeddingRequest): Promise<LlmResult<number[]>> {
    const startedAt = Date.now();
    const response = await this.embeddingClient.embeddings.create({
      model: this.options.embeddingModel ?? this.options.model,
      encoding_format: "float",
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
