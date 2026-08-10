import { mergeDerivedChangePctQuotes, type Quote } from "@fe-radar/core";
import { withScrubber } from "./middleware/scrubber";
import { createDeepSeekClient } from "./clients/deepseek";
import type { LlmResult } from "./types";

// ──────────────────────────────────────────────
// BRIEFING_SCHEMA — 7 段 LLM 产出 (design §6.1)
// NOTE: support / resistance 数值字段不在此处 —— 由
//       packages/core/briefing.ts computeSupportResistance()
//       计算后在 briefing-gen step 3.5 注入 payload_json
// ──────────────────────────────────────────────
export const BRIEFING_SCHEMA = {
  type: "object",
  required: ["cu", "lc", "macro_summary", "risk_notes", "procurement_advice"],
  additionalProperties: false,
  properties: {
    cu: {
      type: "object",
      required: ["logic_summary", "outlook"],
      additionalProperties: false,
      properties: {
        logic_summary: { type: "string", maxLength: 400 },
        outlook: {
          type: "object",
          required: ["trend"],
          additionalProperties: false,
          properties: {
            trend: { type: "string", enum: ["偏多", "区间震荡", "偏弱"] }
            // support/resistance 由代码计算，不在 LLM schema
          }
        }
      }
    },
    lc: {
      type: "object",
      required: ["logic_summary", "outlook"],
      additionalProperties: false,
      properties: {
        logic_summary: { type: "string", maxLength: 400 },
        outlook: {
          type: "object",
          required: ["trend"],
          additionalProperties: false,
          properties: {
            trend: { type: "string", enum: ["偏多", "区间震荡", "偏弱"] }
          }
        }
      }
    },
    macro_summary: { type: "string", maxLength: 300 },
    risk_notes: {
      type: "array",
      items: { type: "string", maxLength: 100 },
      maxItems: 5
    },
    procurement_advice: {
      type: "string",
      enum: [
        "全面观望，等待价格回落",
        "刚需少量补库，大批量采购暂缓",
        "逢关键支撑位分批锁价备货",
        "严控现有库存，放缓整体备货节奏"
      ]
    }
  }
} as const;

export type BriefingTrend = "偏多" | "区间震荡" | "偏弱";

export type BriefingProcurementAdvice =
  | "全面观望，等待价格回落"
  | "刚需少量补库，大批量采购暂缓"
  | "逢关键支撑位分批锁价备货"
  | "严控现有库存，放缓整体备货节奏";

/** LLM 产出的 7 段结构（不含 support/resistance 数值）*/
export interface BriefingOutput {
  cu: {
    logic_summary: string;
    outlook: { trend: BriefingTrend };
  };
  lc: {
    logic_summary: string;
    outlook: { trend: BriefingTrend };
  };
  macro_summary: string;
  risk_notes: string[];
  procurement_advice: BriefingProcurementAdvice;
}

// ──────────────────────────────────────────────
// BRIEFING_SYSTEM_PROMPT — 5 条硬约束 (design §6.2)
// 生产调用 DeepSeek（Kimi 网关无公网出口）；常量名历史曾为 KIMI_*。
// ──────────────────────────────────────────────
export const BRIEFING_SYSTEM_PROMPT = [
  "你是远东控股的大宗商品分析师。基于以下数值与新闻摘要，输出 JSON。",
  "严格遵守：",
  "1. 任何数字必须来源于「当日数值」或「近 5 日序列」输入，禁止虚构",
  "2. 不输出任何「建议交易」或「投资意见」字样",
  "3. 不输出任何价格数值字段（支撑位/压力位由后端代码计算，不在你的 schema 内；如需在文本中提及价格区间，使用「数据见行情数值字段」之类的转写，禁止编造具体数字）",
  "4. logic_summary 中可引用输入的具体数值，但不得给出未来价位预测",
  "5. 输出严格符合 schema（schemaName='briefing'）；JSON 解析失败将被丢弃；risk_notes 必须列具体宏观/商品因子，不许空话"
].join("\n");

/** @deprecated 使用 BRIEFING_SYSTEM_PROMPT；保留别名避免外部引用断裂 */
export const KIMI_BRIEFING_SYSTEM_PROMPT = BRIEFING_SYSTEM_PROMPT;

// ──────────────────────────────────────────────
// NewsItem — 行业新闻摘要（briefing-gen step 2 上下文）
// ──────────────────────────────────────────────
export interface NewsItem {
  title: string;
  summaryZh: string;
  publishedAt: Date;
  category?: string;
}

// ──────────────────────────────────────────────
// buildBriefingInput — 组装 user prompt (design §6.3)
// ──────────────────────────────────────────────

/**
 * 把 quotes 近日数据 + 行业新闻摘要 + 节假日上下文组装为 Kimi user prompt。
 *
 * @param quotes       - 最近 N 日 Quote 数组（由调用方从 commodity_quotes 读取）
 * @param contextNews  - 近 24h 铜锂相关 items（≤30 条）
 * @param holidayDate  - 若当日紧邻节假日，传入节假日日期以提示模型
 */
export function buildBriefingInput(
  quotes: Quote[],
  contextNews: NewsItem[],
  holidayDate?: Date
): string {
  const sections: string[] = [];

  // 1. 节假日上下文
  if (holidayDate !== undefined) {
    const dateStr = holidayDate.toISOString().slice(0, 10);
    sections.push(`> **节假日提示**：${dateStr} 为节假日，行情数据可能不完整，请据实分析。`);
  }

  // 2. 当日数值
  const today = quotes.length > 0
    ? quotes[0]!.observedAt.toISOString().slice(0, 10)
    : "（无数据）";
  sections.push(`## 当日行情数值（${today}）`);

  if (quotes.length === 0) {
    sections.push("_当日数值缺失，请基于近期序列谨慎分析。_");
  } else {
    // T-REV-02 fix: fold cu_change_pct / lc_change_pct rows into close.changePct;
    // do not list derived rows as standalone "行情项".
    const displayQuotes = mergeDerivedChangePctQuotes(quotes);
    const quoteLines = displayQuotes.map((q) => {
      const val = q.value !== null ? String(q.value) : "—";
      const chg = q.changePct !== null ? `${(q.changePct * 100).toFixed(2)}%` : "—";
      return `- **${q.metricKey}**: ${val}（涨跌幅 ${chg}）`;
    });
    sections.push(quoteLines.join("\n"));
  }

  // 3. 行业新闻摘要（≤30 条）
  sections.push(`\n## 近 24h 铜锂相关行业动态（共 ${contextNews.length} 条）`);

  if (contextNews.length === 0) {
    sections.push("_暂无近 24h 相关行业动态。_");
  } else {
    const newsLines = contextNews.slice(0, 30).map((item, idx) => {
      const dateStr = item.publishedAt.toISOString().slice(0, 10);
      const cat = item.category !== undefined ? `【${item.category}】` : "";
      return `${idx + 1}. ${cat}${item.title}（${dateStr}）\n   ${item.summaryZh}`;
    });
    sections.push(newsLines.join("\n\n"));
  }

  sections.push(
    "\n请根据上述数据，输出严格符合 schema 的 JSON 简报（schemaName='briefing'）。"
  );

  return sections.join("\n\n");
}

// ──────────────────────────────────────────────
// runBriefingGen — 包装函数，withScrubber 强制脱敏 (design §6.4 + CLAUDE.md 硬约束)
// ──────────────────────────────────────────────

/**
 * 调用 DeepSeek 生成简报 7 段结构化输出。
 * （原设计为 Kimi K2.6；因 Kimi 网关无公网出口，生产改用同网关可达的 DeepSeek。）
 * 内部通过 withScrubber 中间件保证：
 *   - 公网 LLM 调用前脱敏（PII 命中 block → 抛 LlmError）
 *   - audit log 写入（scrubber 内部处理）
 */
export async function runBriefingGen(input: string, projectCodes?: string[]): Promise<LlmResult<BriefingOutput>> {
  // Kimi 网关无公网出口（转发 api.moonshot.cn 超时），改用同网关可达的 DeepSeek
  const client = createDeepSeekClient();
  // T-SEC-09: 注入项目代号字典（由 briefing-gen job 从 DB 加载后传入）。
  const scrubbed = withScrubber(client, projectCodes?.length ? { projectCodes } : undefined);
  return scrubbed.chatJson<BriefingOutput>({
    system: BRIEFING_SYSTEM_PROMPT,
    schemaName: "briefing",
    schema: BRIEFING_SCHEMA as unknown as Record<string, unknown>,
    user: input
  });
}
