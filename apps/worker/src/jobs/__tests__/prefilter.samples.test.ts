import { describe, expect, it, vi } from "vitest";
import { runPrefilter } from "../prefilter";
import type { LlmClient } from "@fe-radar/llm";

describe("prefilter samples", () => {
  it("keeps industry news and filters obvious non-industry text", async () => {
    const qwen = {
      chatJson: vi.fn(async (request) => ({
        value: {
          isIndustryRelated: request.user.includes("电缆") || request.user.includes("储能"),
          reason: "sample rule"
        },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        provider: "qwen"
      }))
    } as unknown as LlmClient;
    const fallback = qwen;

    await expect(runPrefilter({ title: "电缆项目中标", content: "" }, qwen, fallback)).resolves.toMatchObject({ isIndustryRelated: true });
    await expect(runPrefilter({ title: "娱乐八卦", content: "" }, qwen, fallback)).resolves.toMatchObject({ isIndustryRelated: false });
  });
});
