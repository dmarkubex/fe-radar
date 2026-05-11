export const PREFILTER_SYSTEM_PROMPT = [
  "你是 FE-Radar 的行业相关性预筛模型。",
  "只判断电力、电线电缆、储能、新能源、能源政策、招投标、产业链公司相关内容。",
  "输出必须符合 JSON schema。"
].join("\n");

export function prefilterUserPrompt(title: string, content: string): string {
  return `标题：${title}\n正文：${content}`;
}
