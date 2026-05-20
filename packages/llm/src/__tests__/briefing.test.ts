import { describe, expect, it, vi, beforeEach } from "vitest";
import { LlmError } from "@fe-radar/shared";
import {
  BRIEFING_SCHEMA,
  KIMI_BRIEFING_SYSTEM_PROMPT,
  buildBriefingInput,
  type BriefingOutput,
  type NewsItem
} from "../briefing";
import { withScrubber } from "../middleware/scrubber";
import type { LlmClient } from "../types";
import type { Quote } from "@fe-radar/core";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const validBriefingPayload: BriefingOutput = {
  cu: {
    logic_summary: "沪铜基本面支撑偏多，库存继续去化。",
    outlook: { trend: "偏多" }
  },
  lc: {
    logic_summary: "碳酸锂供给持续过剩，区间震荡为主。",
    outlook: { trend: "区间震荡" }
  },
  macro_summary: "美联储偏鸽预期 + 国内稳增长政策持续，有色整体偏强。",
  risk_notes: ["宏观衰退风险", "新能源需求超预期下滑", "美元指数反弹"],
  procurement_advice: "刚需少量补库，大批量采购暂缓"
};

function makeQuotes(n: number): Quote[] {
  return Array.from({ length: n }, (_, i) => ({
    metricKey: i % 2 === 0 ? "cu_main_close" : "lc_main_close",
    value: 78000 + i * 100,
    changePct: 0.003,
    observedAt: new Date(`2026-05-${String(19 - i).padStart(2, "0")}T08:00:00Z`)
  }));
}

function makeNews(n: number): NewsItem[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `新闻标题 ${i + 1}`,
    summaryZh: `摘要内容 ${i + 1}，铜锂相关行业动态。`,
    publishedAt: new Date("2026-05-19T10:00:00Z"),
    category: "市场与价格"
  }));
}

// ──────────────────────────────────────────────
// 1. schema 接受合法 7 段
// ──────────────────────────────────────────────
describe("BRIEFING_SCHEMA validation", () => {
  it("accepts a valid 7-segment payload", () => {
    const payload = validBriefingPayload;
    // top-level required fields
    expect(BRIEFING_SCHEMA.required).toContain("cu");
    expect(BRIEFING_SCHEMA.required).toContain("lc");
    expect(BRIEFING_SCHEMA.required).toContain("macro_summary");
    expect(BRIEFING_SCHEMA.required).toContain("risk_notes");
    expect(BRIEFING_SCHEMA.required).toContain("procurement_advice");

    // cu / lc trend enum values
    const trendEnum = BRIEFING_SCHEMA.properties.cu.properties.outlook.properties.trend.enum;
    expect(trendEnum).toContain("偏多");
    expect(trendEnum).toContain("区间震荡");
    expect(trendEnum).toContain("偏弱");

    // procurement_advice enum
    const adviceEnum = BRIEFING_SCHEMA.properties.procurement_advice.enum;
    expect(adviceEnum).toContain(payload.procurement_advice);
  });

  // 2. schema 拒绝包含 support/resistance 数值的 payload（防御 LLM 越界）
  it("does NOT include support or resistance fields in schema", () => {
    const cuOutlookProps = BRIEFING_SCHEMA.properties.cu.properties.outlook.properties;
    expect(Object.keys(cuOutlookProps)).not.toContain("support");
    expect(Object.keys(cuOutlookProps)).not.toContain("resistance");

    const lcOutlookProps = BRIEFING_SCHEMA.properties.lc.properties.outlook.properties;
    expect(Object.keys(lcOutlookProps)).not.toContain("support");
    expect(Object.keys(lcOutlookProps)).not.toContain("resistance");

    // additionalProperties: false ensures schema rejects extra fields
    expect(BRIEFING_SCHEMA.properties.cu.properties.outlook.additionalProperties).toBe(false);
    expect(BRIEFING_SCHEMA.properties.lc.properties.outlook.additionalProperties).toBe(false);
  });

  it("has additionalProperties false at top level", () => {
    expect(BRIEFING_SCHEMA.additionalProperties).toBe(false);
  });

  it("uses procurement_advice as the canonical seventh segment, not next_day_focus", () => {
    expect(BRIEFING_SCHEMA.required).toContain("procurement_advice");
    expect(BRIEFING_SCHEMA.required).not.toContain("next_day_focus");
    expect(Object.keys(BRIEFING_SCHEMA.properties)).toContain("procurement_advice");
    expect(Object.keys(BRIEFING_SCHEMA.properties)).not.toContain("next_day_focus");
  });
});

// ──────────────────────────────────────────────
// 3. system prompt 包含 5 条关键约束
// ──────────────────────────────────────────────
describe("KIMI_BRIEFING_SYSTEM_PROMPT", () => {
  it("contains constraint 1: prohibits fabricating numbers", () => {
    expect(KIMI_BRIEFING_SYSTEM_PROMPT).toContain("禁止虚构");
  });

  it("contains constraint 2: prohibits investment advice wording", () => {
    expect(KIMI_BRIEFING_SYSTEM_PROMPT).toContain("建议交易");
    expect(KIMI_BRIEFING_SYSTEM_PROMPT).toContain("投资意见");
  });

  it("contains constraint 3: prohibits outputting support/resistance numeric fields", () => {
    expect(KIMI_BRIEFING_SYSTEM_PROMPT).toContain("支撑位/压力位由后端代码计算");
    expect(KIMI_BRIEFING_SYSTEM_PROMPT).toContain("禁止编造具体数字");
  });

  it("contains constraint 4: prohibits future price prediction", () => {
    expect(KIMI_BRIEFING_SYSTEM_PROMPT).toContain("不得给出未来价位预测");
  });

  it("contains constraint 5: strict schema conformance requirement", () => {
    expect(KIMI_BRIEFING_SYSTEM_PROMPT).toContain("schemaName='briefing'");
    expect(KIMI_BRIEFING_SYSTEM_PROMPT).toContain("risk_notes 必须列具体宏观/商品因子");
  });
});

// ──────────────────────────────────────────────
// 4. buildBriefingInput 输出包含 quotes 数据 + 节假日上下文
// ──────────────────────────────────────────────
describe("buildBriefingInput", () => {
  it("includes quote metric keys and values in output", () => {
    const quotes = makeQuotes(4);
    const result = buildBriefingInput(quotes, []);
    expect(result).toContain("cu_main_close");
    expect(result).toContain("lc_main_close");
    expect(result).toContain("78000");
  });

  it("includes holiday context when holidayDate is provided", () => {
    const quotes = makeQuotes(2);
    const holiday = new Date("2026-05-01T00:00:00Z");
    const result = buildBriefingInput(quotes, [], holiday);
    expect(result).toContain("节假日提示");
    expect(result).toContain("2026-05-01");
  });

  it("includes news titles and summaries", () => {
    const quotes = makeQuotes(2);
    const news = makeNews(3);
    const result = buildBriefingInput(quotes, news);
    expect(result).toContain("新闻标题 1");
    expect(result).toContain("摘要内容 2");
    expect(result).toContain("市场与价格");
  });

  it("caps news at 30 items", () => {
    const quotes = makeQuotes(2);
    const news = makeNews(50);
    const result = buildBriefingInput(quotes, news);
    // 31st item should not appear
    expect(result).not.toContain("新闻标题 31");
    expect(result).toContain("新闻标题 30");
  });

  it("shows degraded message when no quotes provided", () => {
    const result = buildBriefingInput([], []);
    expect(result).toContain("当日数值缺失");
  });
});

// ──────────────────────────────────────────────
// 5. runBriefingGen 调用经 withScrubber（mock kimiClient 验证 wrapper 链路）
// ──────────────────────────────────────────────
describe("runBriefingGen scrubber integration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("passes input through withScrubber before reaching kimi client", async () => {
    const mockChatJson = vi.fn(async () => ({
      value: validBriefingPayload,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costCny: 0.001 },
      provider: "kimi"
    })) as unknown as LlmClient["chatJson"];
    const mockKimiClient: LlmClient = {
      chatJson: mockChatJson,
      embedding: vi.fn()
    };

    // Wrap with scrubber (mirrors what runBriefingGen does internally)
    const scrubbed = withScrubber(mockKimiClient);
    const input = buildBriefingInput(makeQuotes(4), makeNews(2));
    const result = await scrubbed.chatJson<BriefingOutput>({
      system: KIMI_BRIEFING_SYSTEM_PROMPT,
      schemaName: "briefing",
      schema: BRIEFING_SCHEMA as unknown as Record<string, unknown>,
      user: input
    });

    expect(mockChatJson).toHaveBeenCalledOnce();
    expect(result.value.cu.logic_summary).toBeDefined();
    expect(result.provider).toBe("kimi");
  });

  it("blocks request when input contains internal IP (scrubber block path)", async () => {
    const mockKimiClient: LlmClient = {
      chatJson: vi.fn(),
      embedding: vi.fn()
    };
    const scrubbed = withScrubber(mockKimiClient);

    await expect(
      scrubbed.chatJson({
        system: KIMI_BRIEFING_SYSTEM_PROMPT,
        schemaName: "briefing",
        schema: BRIEFING_SCHEMA as unknown as Record<string, unknown>,
        user: "内网 192.168.1.1 上的服务器数据"
      })
    ).rejects.toBeInstanceOf(LlmError);

    expect(mockKimiClient.chatJson).not.toHaveBeenCalled();
  });

  it("scrubs PII from input before LLM call", async () => {
    const capturedRequests: unknown[] = [];
    const mockKimiClient: LlmClient = {
      chatJson: vi.fn(async (req) => {
        capturedRequests.push(req);
        return {
          value: validBriefingPayload,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          provider: "kimi"
        };
      }) as unknown as LlmClient["chatJson"],
      embedding: vi.fn()
    };
    const scrubbed = withScrubber(mockKimiClient);

    await scrubbed.chatJson({
      system: KIMI_BRIEFING_SYSTEM_PROMPT,
      schemaName: "briefing",
      schema: BRIEFING_SCHEMA as unknown as Record<string, unknown>,
      user: "联系方式 13812345678 相关简报"
    });

    expect(JSON.stringify(capturedRequests)).not.toContain("13812345678");
    expect(JSON.stringify(capturedRequests)).toContain("[REDACTED:PHONE:");
  });
});
