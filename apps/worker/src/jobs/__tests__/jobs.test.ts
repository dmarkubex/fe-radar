import { describe, expect, it, vi } from "vitest";
import { computeAlert } from "@fe-radar/core";
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
    const qwen = { chatJson: vi.fn(async () => ({ value: { entities: [{ type: "region", text: "江苏" }] }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, provider: "qwen" })) } as unknown as LlmClient;
    const deepseek = { chatJson: vi.fn() } as unknown as LlmClient;
    const result = await runNer("远东电缆 GB/T 12706 江苏", new EntityDictionary([{ id: 1, type: "company", canonicalName: "远东电缆", aliases: [], circle: "C1" }]), qwen, deepseek);
    expect(result.entities.map((entity) => entity.type)).toContain("policy");
    expect(result.entities.map((entity) => entity.canonicalName)).toContain("远东电缆");
  });

  it("NER falls back to DeepSeek when Qwen fails", async () => {
    const qwen = { chatJson: vi.fn(async () => { throw new Error("down"); }) } as unknown as LlmClient;
    const deepseek = { chatJson: vi.fn(async () => ({ value: { entities: [{ type: "region", text: "江苏" }] }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, provider: "deepseek" })) } as unknown as LlmClient;
    const result = await runNer("远东电缆 GB/T 12706 江苏", new EntityDictionary([]), qwen, deepseek);
    expect(result.entities).toEqual(expect.arrayContaining([{ type: "region", text: "江苏" }]));
  });

  it("normalizes a real accident NER variant before safety alert evaluation", async () => {
    const qwen = { chatJson: vi.fn(async () => ({
      value: { entities: [{ type: "event_type", text: "发生安全事故", canonicalName: "安全事故" }] },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      provider: "qwen"
    })) } as unknown as LlmClient;
    const result = await runNer("某厂发生安全事故", new EntityDictionary([]), qwen, { chatJson: vi.fn() } as unknown as LlmClient);

    expect(result.entities).toContainEqual({ type: "event_type", text: "发生安全事故", canonicalName: "事故" });
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { d1Policy: 0, d2Chain: 0, d3Market: 0, d4Tech: 0, d5Business: 70 },
      entities: result.entities.map((entity, id) => ({ id, type: entity.type, canonicalName: entity.canonicalName ?? "" }))
    })).toEqual({ alertType: "safety", alertLevel: "L1" });
  });

  it("normalizes an electrocution death before safety alert evaluation", async () => {
    const qwen = { chatJson: vi.fn(async () => ({
      value: { entities: [{ type: "event_type", text: "工人触电死亡", canonicalName: "触电" }] },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      provider: "qwen"
    })) } as unknown as LlmClient;
    const result = await runNer("某厂发生工人触电死亡事故", new EntityDictionary([]), qwen, { chatJson: vi.fn() } as unknown as LlmClient);

    expect(result.entities).toContainEqual({ type: "event_type", text: "工人触电死亡", canonicalName: "事故" });
    expect(computeAlert({
      source: { tier: "T1" },
      scores: { d1Policy: 0, d2Chain: 0, d3Market: 0, d4Tech: 0, d5Business: 70 },
      entities: result.entities.map((entity, id) => ({ id, type: entity.type, canonicalName: entity.canonicalName ?? "" }))
    })).toEqual({ alertType: "safety", alertLevel: "L1" });
  });

  it("NER continues with dictionary/policy hits when both LLMs fail", async () => {
    const qwen = { chatJson: vi.fn(async () => { throw new Error("down"); }) } as unknown as LlmClient;
    const deepseek = { chatJson: vi.fn(async () => { throw new Error("also down"); }) } as unknown as LlmClient;
    const result = await runNer("远东电缆 GB/T 12706", new EntityDictionary([{ id: 1, type: "company", canonicalName: "远东电缆", aliases: [], circle: "C1" }]), qwen, deepseek);
    expect(result.entities.map((entity) => entity.canonicalName)).toContain("远东电缆");
    expect(result.entities.map((entity) => entity.type)).toContain("policy");
  });

  it("scorer maps scrubber block to manual summary", async () => {
    const llm = { chatJson: vi.fn(async () => { throw new LlmError("SCRUBBER_BLOCKED", "blocked"); }) } as unknown as LlmClient;
    await expect(runScorer("pii", llm)).resolves.toMatchObject({ summaryZh: BLOCKED_SUMMARY });
  });

  it("embedder enforces 1024 dimensions", async () => {
    const llm = { embedding: vi.fn(async () => ({ value: Array.from({ length: 1024 }, () => 0.1), usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 }, provider: "qwen" })) } as unknown as LlmClient;
    await expect(runEmbedder("title", "summary", llm)).resolves.toHaveLength(1024);
  });

  it("embedder returns null when scrubber blocks", async () => {
    const llm = { embedding: vi.fn(async () => { throw new LlmError("SCRUBBER_BLOCKED", "blocked"); }) } as unknown as LlmClient;
    await expect(runEmbedder("pii title", "pii summary", llm)).resolves.toBeNull();
  });

  it("embedder rethrows non-scrubber errors", async () => {
    const llm = { embedding: vi.fn(async () => { throw new Error("network failure"); }) } as unknown as LlmClient;
    await expect(runEmbedder("title", "summary", llm)).rejects.toThrow("network failure");
  });

  it("cluster lock uses acquire and release lua", async () => {
    const evalMock = vi.fn(async (script: string) => script.includes("SET") ? 1 : 0);
    await expect(withClusterCreateLock({ eval: evalMock } as never, async () => "ok")).resolves.toBe("ok");
    expect(evalMock).toHaveBeenCalledTimes(2);
  });
});
