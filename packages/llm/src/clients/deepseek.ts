import { OpenAiCompatibleClient, requireEnv } from "../client";

export const DEEPSEEK_SCORING_SCHEMA_NAME = "fe_radar_scoring";

export function createDeepSeekClient(): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient({
    provider: "deepseek",
    apiKey: requireEnv("DEEPSEEK_API_KEY"),
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro",
    inputTokenCostCny: 0.000002,
    outputTokenCostCny: 0.000008
  });
}
