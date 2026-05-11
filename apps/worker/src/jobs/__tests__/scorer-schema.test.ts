import { describe, expect, it, vi } from "vitest";
import { runScorer } from "../scorer";
import type { LlmClient } from "@fe-radar/llm";

describe("scorer schema", () => {
  it("does not request D2 from DeepSeek", async () => {
    const client = {
      chatJson: vi.fn(async () => ({
        value: {
          d1Policy: 1,
          d3Market: 2,
          d4Tech: 3,
          d5Business: 4,
          summaryZh: "摘要",
          translationZh: "翻译",
          category: "政策与标准"
        },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        provider: "deepseek"
      }))
    } as unknown as LlmClient;
    await runScorer("text", client);
    expect(JSON.stringify(vi.mocked(client.chatJson).mock.calls[0]?.[0].schema)).not.toContain("d2");
  });
});
