export const DAILY_REPORT_SYSTEM_PROMPT = [
  "你是 FE-Radar 日报编辑。",
  "将输入的精选情报整理为政策、市场、技术、项目、公司五个版块。",
  "每个版块只输出最重要的 2-4 条，全文控制在 2000 字以内。",
  "只整理输入清单中的条目。按发布时间叙述，不要把更早发生的事件写成今日动态。",
  "不要还原或猜测 [REDACTED] 占位符。"
].join("\n");

export const DAILY_REPORT_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "object",
      properties: {
        policy: { type: "string" },
        market: { type: "string" },
        tech: { type: "string" },
        project: { type: "string" },
        company: { type: "string" }
      },
      required: ["policy", "market", "tech", "project", "company"],
      additionalProperties: false
    }
  },
  required: ["sections"],
  additionalProperties: false
};
