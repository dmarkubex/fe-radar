import { OpenAiCompatibleClient, requireEnv } from "../client";

export const KIMI_CONTEXT_LIMIT_TOKENS = 200_000;

export function createKimiClient(): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient({
    provider: "kimi",
    apiKey: requireEnv("KIMI_API_KEY"),
    baseURL: process.env.KIMI_BASE_URL ?? "https://api.moonshot.cn/v1",
    model: process.env.KIMI_MODEL ?? "kimi-k2.6",
    inputTokenCostCny: 0.000004,
    outputTokenCostCny: 0.000012
  });
}

export function assertKimiContext(input: string): void {
  const estimatedTokens = Math.ceil(input.length / 2);
  if (estimatedTokens > KIMI_CONTEXT_LIMIT_TOKENS) {
    throw new Error(`Kimi input exceeds ${KIMI_CONTEXT_LIMIT_TOKENS} tokens`);
  }
}
