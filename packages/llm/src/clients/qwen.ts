import { OpenAiCompatibleClient, requireEnv } from "../client";

export function createQwenClient(): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient({
    provider: "qwen",
    apiKey: process.env.QWEN_API_KEY ?? "local-qwen",
    baseURL: process.env.QWEN_BASE_URL ?? "http://localhost:8001/v1",
    model: process.env.QWEN_MODEL ?? "qwen3.6-27b",
    // xinference 的 qwen3 不支持 response_format=json_schema（会无视 schema 并返回
    // markdown 围栏的文本 → JSON.parse 失败），且其报错不触发 auto 降级探测。
    // 故默认强制 json_object（实测可用）；可用 QWEN_JSON_FORMAT 覆盖。
    jsonResponseFormat:
      (process.env.QWEN_JSON_FORMAT as "auto" | "json_schema" | "json_object" | undefined) ?? "json_object",
    embeddingBaseURL: process.env.QWEN_EMBEDDING_BASE_URL,
    embeddingApiKey: process.env.QWEN_EMBEDDING_API_KEY,
    embeddingModel: process.env.QWEN_EMBEDDING_MODEL ?? "qwen-embedding-1024"
  });
}

export function assertQwenConfigured(): void {
  requireEnv("QWEN_BASE_URL");
}
