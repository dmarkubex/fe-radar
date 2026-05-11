import { describe, expect, it, vi } from "vitest";
import { LlmError } from "@fe-radar/shared";
import { runEmbedder } from "../embedder";
import { runNer } from "../ner";
import { BLOCKED_SUMMARY, runScorer } from "../scorer";
import { runPrefilter } from "../prefilter";
import { EntityDictionary } from "../../lib/entities-dict";
import { withClusterCreateLock } from "../cluster";
import type { LlmClient } from "@fe-radar/llm";

describe("pipeline jobs", () => {
  it("prefilter falls back to DeepSeek", async () => {
    const qwen = { chatJson: vi.fn(async () => { throw new Error("down"); }) } as unknown as LlmClient;
    const deepseek = { chatJson: vi.fn(async () => ({ value: { isIndustryRelated: true, reason: "电力" }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, provider: "deepseek" })) } as unknown as LlmClient;
    await expect(runPrefilter({ title: "电网投资", content: "" }, qwen, deepseek)).resolves.toMatchObject({ isIndustryRelated: true });
  });

  it("NER combines dictionary, policy regex, and LLM hits", async () => {
    const llm = { chatJson: vi.fn(async () => ({ value: { entities: [{ type: "region", text: "江苏" }] }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, provider: "qwen" })) } as unknown as LlmClient;
    const result = await runNer("远东电缆 GB/T 12706 江苏", new EntityDictionary([{ id: 1, type: "company", canonicalName: "远东电缆", aliases: [], circle: "C1" }]), llm);
    expect(result.entities.map((entity) => entity.type)).toContain("policy");
    expect(result.entities.map((entity) => entity.canonicalName)).toContain("远东电缆");
  });

  it("scorer maps scrubber block to manual summary", async () => {
    const llm = { chatJson: vi.fn(async () => { throw new LlmError("SCRUBBER_BLOCKED", "blocked"); }) } as unknown as LlmClient;
    await expect(runScorer("pii", llm)).resolves.toMatchObject({ summaryZh: BLOCKED_SUMMARY });
  });

  it("embedder enforces 1024 dimensions", async () => {
    const llm = { embedding: vi.fn(async () => ({ value: Array.from({ length: 1024 }, () => 0.1), usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 }, provider: "qwen" })) } as unknown as LlmClient;
    await expect(runEmbedder("title", "summary", llm)).resolves.toHaveLength(1024);
  });

  it("cluster lock uses acquire and release lua", async () => {
    const evalMock = vi.fn(async (script: string) => script.includes("SET") ? 1 : 0);
    await expect(withClusterCreateLock({ eval: evalMock } as never, async () => "ok")).resolves.toBe("ok");
    expect(evalMock).toHaveBeenCalledTimes(2);
  });
});
