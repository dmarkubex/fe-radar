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
    expect(
      JSON.stringify(vi.mocked(client.chatJson).mock.calls[0]?.[0].schema)
    ).not.toContain("d2");
  });

  it("constrains LLM score atoms to the 0-100 scale", async () => {
    const client = {
      chatJson: vi.fn(async () => ({
        value: {
          d1Policy: 80,
          d3Market: 70,
          d4Tech: 60,
          d5Business: 50,
          summaryZh: "摘要",
          translationZh: "翻译",
          category: "政策与标准"
        },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        provider: "deepseek"
      }))
    } as unknown as LlmClient;

    await runScorer("text", client);

    const schema = vi.mocked(client.chatJson).mock.calls[0]?.[0].schema as {
      properties: Record<string, Record<string, unknown>>;
    };
    for (const atom of [
      "d1Policy",
      "d3Market",
      "d4Tech",
      "d5Business"
    ] as const) {
      expect(schema.properties[atom]).toMatchObject({
        minimum: 0,
        maximum: 100
      });
    }
    expect(vi.mocked(client.chatJson).mock.calls[0]?.[0].temperature).toBe(0);
  });

  it("keeps low 0-100 scores unchanged and clamps to the 0-100 range", async () => {
    const client = {
      chatJson: vi.fn(async () => ({
        value: {
          d1Policy: 8,
          d3Market: -5,
          d4Tech: 120,
          d5Business: 11,
          summaryZh: "摘要",
          translationZh: "翻译",
          category: "政策与标准"
        },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        provider: "deepseek"
      }))
    } as unknown as LlmClient;

    const result = await runScorer("text", client);

    expect(result).toMatchObject({
      d1Policy: 8,
      d3Market: 0,
      d4Tech: 100,
      d5Business: 11
    });
  });

  it("does not inflate valid low 0-100 score atoms", async () => {
    const client = {
      chatJson: vi.fn(async () => ({
        value: {
          d1Policy: 8,
          d3Market: 5.5,
          d4Tech: 0,
          d5Business: 10,
          summaryZh: "摘要",
          translationZh: "翻译",
          category: "政策与标准"
        },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        provider: "deepseek"
      }))
    } as unknown as LlmClient;

    const result = await runScorer("text", client);

    expect(result).toMatchObject({
      d1Policy: 8,
      d3Market: 5.5,
      d4Tech: 0,
      d5Business: 10
    });
  });
});
