import type { FetchContext } from "../types";

/**
 * A single numeric data point fetched from a market data source.
 *
 * NFR-102 数值精度合规：
 * - value=null 表示解析失败但 rawText 保留完整原始文本供审计
 * - rawText 必须在 adapter 层 strip HTML 且截断 ≤ 2000 字符（Unicode code points）
 * - 禁止在 fetcher 层调 LLM 抽取数值
 */
export interface QuoteSample {
  metricKey: string;
  value: number | null;
  observedAt: Date;
  rawText: string;
  sourceMetadata?: Record<string, unknown>;
}

/**
 * Interface every quotes adapter must implement.
 *
 * Adapter 失败必须返回 [] 不抛异常；上层 job 负责 markSourceFailure。
 */
export interface QuotesAdapter {
  name: string;
  fetch(ctx: FetchContext): Promise<QuoteSample[]>;
}
