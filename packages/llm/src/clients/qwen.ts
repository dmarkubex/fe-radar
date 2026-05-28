import { OpenAiCompatibleClient, requireEnv } from "../client";

export function createQwenClient(): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient({
    provider: "qwen",
    apiKey: process.env.QWEN_API_KEY ?? "local-qwen",
    baseURL: process.env.QWEN_BASE_URL ?? "http://localhost:8001/v1",
    model: process.env.QWEN_MODEL ?? "qwen3.6-27b",
    embeddingBaseURL: process.env.QWEN_EMBEDDING_BASE_URL,
    embeddingApiKey: process.env.QWEN_EMBEDDING_API_KEY,
    embeddingModel: process.env.QWEN_EMBEDDING_MODEL ?? "qwen-embedding-1024"
  });
}

export function assertQwenConfigured(): void {
  requireEnv("QWEN_BASE_URL");
}
