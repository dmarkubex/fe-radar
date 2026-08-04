import { describe, expect, it, vi } from "vitest";
import { PREFILTER_SYSTEM_PROMPT, type LlmClient } from "@fe-radar/llm";
import { runPrefilter } from "../prefilter";

describe("prefilter samples", () => {
  it("keeps cable, storage, and optical-fiber samples while filtering broad tech news", async () => {
    const industryKeywords = [
      "电缆",
      "储能",
      "光纤",
      "光缆",
      "光通信",
      "光模块",
      "OPGW",
      "ADSS"
    ];
    const qwen = {
      chatJson: vi.fn(async (request) => ({
        value: {
          isIndustryRelated: industryKeywords.some((keyword) =>
            request.user.includes(keyword)
          ),
          reason: "sample rule"
        },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        provider: "qwen"
      }))
    } as unknown as LlmClient;
    const fallback = qwen;

    for (const title of [
      "远东电缆中标国家电网项目",
      "储能电站扩容带动电池需求",
      "运营商启动新一轮光纤光缆集采",
      "特高压线路新增 OPGW 光缆招标",
      "山区输电线路采购 ADSS 光缆",
      "数据中心扩建带动高速光模块需求"
    ]) {
      await expect(
        runPrefilter({ title, content: "" }, qwen, fallback)
      ).resolves.toMatchObject({ isIndustryRelated: true });
    }

    for (const title of [
      "明星不投火锅店了，改投硬科技",
      "中国机器人最热闹的一周，资本跑赢了订单",
      "一加、realme 分家，OPPO 更难谁"
    ]) {
      await expect(
        runPrefilter({ title, content: "" }, qwen, fallback)
      ).resolves.toMatchObject({ isIndustryRelated: false });
    }
  });

  it("sends explicit optical-fiber scope and broad-tech exclusions to the model", async () => {
    const qwen = {
      chatJson: vi.fn(async () => ({
        value: { isIndustryRelated: true, reason: "prompt contract" },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        provider: "qwen"
      }))
    } as unknown as LlmClient;

    await runPrefilter({ title: "光通信项目", content: "" }, qwen, qwen);

    expect(PREFILTER_SYSTEM_PROMPT).toContain("光纤光缆与光通信");
    expect(PREFILTER_SYSTEM_PROMPT).toContain("submarine cable");
    expect(PREFILTER_SYSTEM_PROMPT).toContain("energy storage");
    expect(PREFILTER_SYSTEM_PROMPT).toContain("消费电子");
    expect(PREFILTER_SYSTEM_PROMPT).toContain("通用机器人");
    expect(qwen.chatJson).toHaveBeenCalledWith(
      expect.objectContaining({
        system: PREFILTER_SYSTEM_PROMPT
      })
    );
  });
});
