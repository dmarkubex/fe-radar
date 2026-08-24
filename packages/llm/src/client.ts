import OpenAI from "openai";
import pino from "pino";
import { LlmError } from "@fe-radar/shared";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam
} from "openai/resources/chat/completions";
import type {
  ChatMessage,
  ChatStreamDelta,
  ChatStreamRequest,
  EmbeddingRequest,
  JsonSchemaRequest,
  LlmClient,
  LlmResult,
  LlmUsage
} from "./types";

const logger = pino({ name: "fe-radar-llm" });

/**
 * T-CH-01: worker `/internal/llm` 单次生成总时长硬上限错误码 —— 单一来源。
 * worker `internal/llm.ts` 引用此常量写错误包络（首字节前 JSON / 已流出后 SSE 两种形态）；
 * copilot Python 侧用同一字面量解析并透传给客户端 SSE error 帧。
 * 跨语言契约由 worker / copilot 两侧测试锁定，禁止任一侧自行改名。
 */
export const LLM_HARD_TIMEOUT_CODE = "COPILOT_LLM_HARD_TIMEOUT";

/** Strip optional markdown code fences (e.g. ```json … ```) before JSON.parse. */
export function stripMarkdownJsonFence(content: string): string {
  const trimmed = content.trim();
  const closedFence = trimmed.match(
    /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i
  );
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
  /**
   * 每客户端默认采样温度（request.temperature 未指定时生效）。
   * 缺省回退 0.2；kimi-k2.6 仅接受 temperature=1，需在 createKimiClient 设为 1。
   */
  defaultTemperature?: number;
}

export class OpenAiCompatibleClient implements LlmClient {
  private readonly client: OpenAI;
  private readonly embeddingClient: OpenAI;
  /** auto 模式下探测到 json_schema 不可用后，后续请求跳过探测 */
  private jsonSchemaCapability: "unknown" | "supported" | "unsupported" =
    "unknown";

  public constructor(private readonly options: OpenAiCompatibleOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL
    });
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
        const usage = this.usage(
          response.usage?.prompt_tokens ?? 0,
          response.usage?.completion_tokens ?? 0
        );
        logger.info(
          {
            provider: this.options.provider,
            tokens: usage,
            latencyMs: Date.now() - startedAt
          },
          "llm chat_json complete"
        );
        return { value, usage, provider: this.options.provider };
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          logger.warn(
            { provider: this.options.provider, attempt: attempt + 1, error },
            "llm chat_json attempt failed, retrying"
          );
        }
      }
    }

    throw new LlmError(
      "LLM_JSON_INVALID",
      "LLM JSON schema request failed after retries",
      { cause: lastError }
    );
  }

  /**
   * 流式对话（tools + stream）。每次调用独立 timeout 60s、0 重试、透传 AbortSignal；
   * 不改构造器默认（chatJson 的应用层 3 次重试保持不变）。
   */
  public async *chatStream(
    request: ChatStreamRequest
  ): AsyncIterable<ChatStreamDelta> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.options.model,
        temperature:
          request.temperature ?? this.options.defaultTemperature ?? 0.2,
        messages: toOpenAiChatMessages(request.messages),
        tools: request.tools,
        // agentscope 压缩触发的合成工具选择（`ToolChoice(mode="<tool_name>")`）；
        // 仅在 `tool_choice` 已显式传入时透传，缺省沿用 OpenAI 默认（auto），不破坏既有调用
        ...(request.tool_choice !== undefined
          ? { tool_choice: request.tool_choice }
          : {}),
        stream: true,
        stream_options: { include_usage: true }
      },
      { timeout: 60_000, maxRetries: 0, signal: request.signal }
    );

    const pendingToolCalls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let usage: LlmUsage | undefined;

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = this.usage(
          chunk.usage.prompt_tokens ?? 0,
          chunk.usage.completion_tokens ?? 0
        );
      }
      const choice = chunk.choices[0];
      if (!choice) {
        continue;
      }
      if (choice.delta?.content) {
        yield { type: "token", data: choice.delta.content };
      }
      for (const toolCall of choice.delta?.tool_calls ?? []) {
        const pending = pendingToolCalls.get(toolCall.index) ?? {
          id: "",
          name: "",
          arguments: ""
        };
        if (toolCall.id) {
          pending.id = toolCall.id;
        }
        if (toolCall.function?.name) {
          pending.name = toolCall.function.name;
        }
        if (toolCall.function?.arguments) {
          pending.arguments += toolCall.function.arguments;
        }
        pendingToolCalls.set(toolCall.index, pending);
      }
      if (choice.finish_reason === "tool_calls") {
        yield* flushToolCalls(pendingToolCalls);
      }
    }

    // 流结束仍未收到 finish_reason=tool_calls 时也要发完整 tool_call 帧
    yield* flushToolCalls(pendingToolCalls);
    if (usage) {
      yield { type: "usage", data: usage };
    }
    yield { type: "done" };
  }

  private async createChatJsonCompletion(request: JsonSchemaRequest) {
    const format = this.resolveJsonResponseFormat();
    if (format === "json_object") {
      return this.client.chat.completions.create(
        this.chatJsonParams(request, "json_object")
      );
    }

    try {
      const response = await this.client.chat.completions.create(
        this.chatJsonParams(request, "json_schema")
      );
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
      logger.info(
        { provider: this.options.provider },
        "llm json_schema unavailable, using json_object"
      );
      return this.client.chat.completions.create(
        this.chatJsonParams(request, "json_object")
      );
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

  private chatJsonParams(
    request: JsonSchemaRequest,
    responseFormat: "json_schema" | "json_object"
  ): ChatCompletionCreateParamsNonStreaming {
    const system =
      responseFormat === "json_schema"
        ? request.system
        : `${request.system}\n\nReturn one valid JSON object only. It must satisfy this JSON Schema: ${JSON.stringify(request.schema)}`;

    return {
      model: this.options.model,
      temperature:
        request.temperature ?? this.options.defaultTemperature ?? 0.2,
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
    return (
      text.includes("response_format") &&
      (text.includes("unavailable") || text.includes("unsupported"))
    );
  }

  public async embedding(
    request: EmbeddingRequest
  ): Promise<LlmResult<number[]>> {
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
    logger.info(
      {
        provider: this.options.provider,
        tokens: usage,
        latencyMs: Date.now() - startedAt
      },
      "llm embedding complete"
    );
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

function toOpenAiChatMessages(
  messages: ChatMessage[]
): ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: message.content,
        tool_call_id: message.tool_call_id ?? ""
      };
    }
    if (message.role === "assistant" && message.tool_calls) {
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments }
        }))
      };
    }
    return { role: message.role, content: message.content };
  });
}

function* flushToolCalls(
  pending: Map<number, { id: string; name: string; arguments: string }>
): Generator<ChatStreamDelta> {
  for (const index of [...pending.keys()].sort((a, b) => a - b)) {
    const call = pending.get(index);
    if (call) {
      pending.delete(index);
      yield { type: "tool_call", data: call };
    }
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new LlmError("LLM_CONFIG", `${name} is required`);
  }
  return value;
}
