import { describe, expect, it, vi } from "vitest";
import type { LlmClient, NerEntityResult } from "@fe-radar/llm";
import { detectPolicyEntities } from "../../lib/entities-dict";
import { runNer, validateLlmEntity } from "../ner";
import { EntityDictionary } from "../../lib/entities-dict";

describe("NER policy regex", () => {
  it("detects GB/T and NB/T standard numbers", () => {
    expect(detectPolicyEntities("GB/T 12706-2020 与 NB/T 31089")).toEqual([
      { type: "policy", span: "GB/T 12706-2020", canonicalName: "GB/T12706-2020" },
      { type: "policy", span: "NB/T 31089", canonicalName: "NB/T31089" }
    ]);
  });
});

describe("NER trust-boundary validator (T-RR-02)", () => {
  const text = "某厂发生安全事故 远东电缆 GB/T 12706 江苏";

  it("rejects hallucinated span (LLM span not present in input text)", () => {
    expect(
      validateLlmEntity(
        { type: "company", text: "华为", canonicalName: "华为" },
        text
      )
    ).toBeNull();
  });

  it("rejects empty span", () => {
    expect(
      validateLlmEntity({ type: "region", text: "  ", canonicalName: "广东" }, text)
    ).toBeNull();
  });

  it("canonicalizes a real accident span to 事故", () => {
    expect(
      validateLlmEntity(
        { type: "event_type", text: "发生安全事故", canonicalName: "安全事故" },
        text
      )
    ).toEqual({
      type: "event_type",
      text: "发生安全事故",
      canonicalName: "事故",
    });
  });

  it("rejects event_type when span contains no accident keyword (drops invalid event_type hits)", () => {
    expect(
      validateLlmEntity(
        { type: "event_type", text: "发布新品", canonicalName: "事故" },
        text
      )
    ).toBeNull();
  });

  it("rejects event_type with only hallucinated canonicalName (canonical-only accident keyword)", () => {
    // span itself has no accident keyword; canonicalName alone must not rescue it.
    expect(
      validateLlmEntity(
        { type: "event_type", text: "新品发布会", canonicalName: "事故" },
        text
      )
    ).toBeNull();
  });

  it("rejects generic policy labels like AI / 创新 / 新能源 (no evidence)", () => {
    expect(
      validateLlmEntity(
        { type: "policy", text: "AI", canonicalName: "AI" },
        "AI 大模型产业政策动向"
      )
    ).toBeNull();
    expect(
      validateLlmEntity(
        { type: "policy", text: "创新", canonicalName: "创新" },
        "国家推动创新驱动发展战略"
      )
    ).toBeNull();
    expect(
      validateLlmEntity(
        { type: "policy", text: "新能源", canonicalName: "新能源" },
        "新能源产业蓬勃发展"
      )
    ).toBeNull();
  });

  it("retains policy when span is a standard number (GB/T 12706)", () => {
    expect(
      validateLlmEntity(
        { type: "policy", text: "GB/T 12706", canonicalName: "GB/T 12706" },
        text
      )
    ).toEqual({
      type: "policy",
      text: "GB/T 12706",
      canonicalName: "GB/T 12706",
    });
  });

  it("retains policy when span is a document number (发改能源〔2024〕12号)", () => {
    expect(
      validateLlmEntity(
        {
          type: "policy",
          text: "发改能源〔2024〕12号",
          canonicalName: "发改能源〔2024〕12号",
        },
        "根据发改能源〔2024〕12号文件精神"
      )
    ).toEqual({
      type: "policy",
      text: "发改能源〔2024〕12号",
      canonicalName: "发改能源〔2024〕12号",
    });
  });

  it("retains policy when span ends in a policy-document term (电力法 / 管理办法 / 通知 ...)", () => {
    expect(
      validateLlmEntity(
        { type: "policy", text: "电力法", canonicalName: "电力法" },
        "本次修订涉及电力法的相关条款"
      )
    ).toEqual({
      type: "policy",
      text: "电力法",
      canonicalName: "电力法",
    });
  });

  it("passes through non-event_type / non-policy LLM hits (company / region / etc.)", () => {
    expect(
      validateLlmEntity(
        { type: "region", text: "江苏", canonicalName: "江苏" },
        text
      )
    ).toEqual({ type: "region", text: "江苏", canonicalName: "江苏" });
  });
});

describe("runNer end-to-end (T-RR-02)", () => {
  const noopLlm = {
    chatJson: vi.fn(async () => ({
      value: { entities: [] },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      provider: "qwen",
    })),
    embedding: vi.fn(),
  } as unknown as LlmClient;

  it("drops a hallucinated policy span from the LLM and keeps dictionary/policy hits", async () => {
    const text = "远东电缆 GB/T 12706 江苏";
    const llm = {
      chatJson: vi.fn(async () => ({
        value: {
          entities: [
            { type: "policy", text: "AI", canonicalName: "AI" }, // hallucinated, generic
            { type: "policy", text: "GB/T 12706", canonicalName: "GB/T 12706" }, // real
          ],
        } satisfies NerEntityResult,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        provider: "qwen",
      })),
      embedding: vi.fn(),
    } as unknown as LlmClient;
    const result = await runNer(
      text,
      new EntityDictionary([{ id: 1, type: "company", canonicalName: "远东电缆", aliases: [], circle: "C1" }]),
      llm,
      noopLlm
    );
    const policies = result.entities.filter((entity) => entity.type === "policy");
    expect(policies.map((entity) => entity.text).sort()).toEqual(["GB/T 12706", "GB/T 12706"]);
    expect(result.entities.map((entity) => entity.canonicalName)).toContain("远东电缆");
  });

  it("drops a hallucinated event_type accident with no accident keyword in span", async () => {
    const text = "某厂发布新品";
    const llm = {
      chatJson: vi.fn(async () => ({
        value: {
          entities: [
            // LLM hallucinated canonicalName=事故 but span lacks accident keyword.
            { type: "event_type", text: "新品发布会", canonicalName: "事故" },
            { type: "company", text: "某厂", canonicalName: "某厂" },
          ],
        } satisfies NerEntityResult,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        provider: "qwen",
      })),
      embedding: vi.fn(),
    } as unknown as LlmClient;
    const result = await runNer(text, new EntityDictionary([]), llm, noopLlm);
    expect(result.entities.some((entity) => entity.type === "event_type")).toBe(false);
  });

  it("retains a real industry accident event_type with a company subject", async () => {
    const text = "远东电缆发生工人触电死亡事故";
    const llm = {
      chatJson: vi.fn(async () => ({
        value: {
          entities: [
            { type: "event_type", text: "工人触电死亡", canonicalName: "触电" },
            { type: "company", text: "远东电缆", canonicalName: "远东电缆" },
          ],
        } satisfies NerEntityResult,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        provider: "qwen",
      })),
      embedding: vi.fn(),
    } as unknown as LlmClient;
    const result = await runNer(text, new EntityDictionary([]), llm, noopLlm);
    expect(result.entities).toContainEqual({
      type: "event_type",
      text: "工人触电死亡",
      canonicalName: "事故",
    });
    expect(result.entities.some((entity) => entity.type === "company")).toBe(true);
  });
});
