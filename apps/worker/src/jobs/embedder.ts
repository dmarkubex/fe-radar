import type { LlmClient } from "@fe-radar/llm";

export function buildEmbeddingInput(title: string, summaryZh: string): string {
  return `${title}\n${summaryZh}`.trim();
}

export async function runEmbedder(title: string, summaryZh: string, qwen: LlmClient): Promise<number[]> {
  const result = await qwen.embedding({ input: buildEmbeddingInput(title, summaryZh) });
  if (result.value.length !== 1024) {
    throw new Error(`Expected embedding dimension 1024, got ${result.value.length}`);
  }
  return result.value;
}
