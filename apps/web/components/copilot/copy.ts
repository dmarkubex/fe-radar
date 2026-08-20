/**
 * 写死的 UI 文案（两处 DOM 都要有，不可被模型 token 替换）。
 * 独立成 .ts：tsconfig jsx=preserve 下 vitest 无法 import .tsx，常量须可从 .ts 断言。
 */
export const CHAT_DISCLAIMER = "模型观点，仅供参考，不构成采购/交易建议";

/** 流结束但无 done/error 时的提示：清等待态、不把半段当结论 */
export const NO_CONCLUSION_NOTICE = "该轮不生成结论";
