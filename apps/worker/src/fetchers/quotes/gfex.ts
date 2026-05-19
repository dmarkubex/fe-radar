import { fetchTextWithPolicy } from "../http";
import type { FetchContext } from "../types";
import type { QuotesAdapter, QuoteSample } from "./types";

/**
 * 广期所（GFEX）碳酸锂主力合约适配器
 *
 * Endpoint: https://www.gfex.com.cn/u00/pub/daily/tradeData.do
 * 返回当日行情 JSON（含 lc 碳酸锂系列合约）。
 *
 * 产出 metrics:
 *   lc_main_close   — 主力合约收盘价（元/吨）
 *   lc_warrants     — 碳酸锂仓单数量（手）
 *
 * NFR-102: 禁止 LLM 抽取数值；解析失败 value=null 保留 rawText。
 */

const GFEX_ENDPOINT = "https://www.gfex.com.cn/u00/pub/daily/tradeData.do";

interface GfexContract {
  instrument_id?: string;
  close_price?: string;
  settlement_price?: string;
  open_interest?: string;
}

interface GfexProduct {
  product_code?: string;
  contracts?: GfexContract[];
  warrant?: {
    warehouse_receipt?: string;
  };
}

interface GfexResponse {
  code?: number;
  data?: {
    trade_date?: string;
    products?: GfexProduct[];
  };
}

/** Strip HTML tags and truncate to ≤2000 Unicode code points (NFR-102 / FR-12). */
function toRawText(text: string): string {
  const stripped = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const codePoints = [...stripped];
  return codePoints.length > 2000 ? codePoints.slice(0, 2000).join("") : stripped;
}

/**
 * Pick the main contract for a product: the one with the highest open interest
 * (largest open_interest value), which is the standard main-contract criterion
 * for GFEX.
 */
function pickMainContract(contracts: GfexContract[]): GfexContract | undefined {
  if (contracts.length === 0) return undefined;
  return contracts.reduce((best, cur) => {
    const bestOi = parseFloat(best.open_interest ?? "0");
    const curOi = parseFloat(cur.open_interest ?? "0");
    return curOi > bestOi ? cur : best;
  });
}

async function fetchGfex(
  ctx: FetchContext,
  _now: Date = new Date(),
  fetchImpl?: typeof fetch
): Promise<QuoteSample[]> {
  const observedAt = _now;

  let rawBody: string;
  try {
    rawBody = await fetchTextWithPolicy(GFEX_ENDPOINT, {
      timeoutMs: 8000,
      useRealUa: ctx.useRealUa ?? true,
      fetchImpl,
    });
  } catch {
    // Network failure → return empty (adapter contract: never throw)
    return [];
  }

  const rawText = toRawText(rawBody);

  let parsed: GfexResponse;
  try {
    parsed = JSON.parse(rawBody) as GfexResponse;
  } catch {
    // JSON parse failure → both metrics null, rawText preserved
    return [
      { metricKey: "lc_main_close", value: null, observedAt, rawText },
      { metricKey: "lc_warrants", value: null, observedAt, rawText },
    ];
  }

  const samples: QuoteSample[] = [];
  const products = parsed.data?.products ?? [];
  const lcProduct = products.find(
    (p) => p.product_code?.toLowerCase() === "lc"
  );

  // lc_main_close
  const contracts = lcProduct?.contracts ?? [];
  const mainContract = pickMainContract(contracts);
  let closeValue: number | null = null;
  if (mainContract) {
    const raw = mainContract.close_price ?? mainContract.settlement_price ?? "";
    const num = parseFloat(raw.replace(/,/g, ""));
    closeValue = isFinite(num) && num > 0 ? num : null;
  }
  samples.push({
    metricKey: "lc_main_close",
    value: closeValue,
    observedAt,
    rawText,
    sourceMetadata: mainContract
      ? { instrumentId: mainContract.instrument_id, exchange: "GFEX" }
      : { exchange: "GFEX" },
  });

  // lc_warrants
  const warrantsRaw = lcProduct?.warrant?.warehouse_receipt;
  let warrantValue: number | null = null;
  if (warrantsRaw !== undefined) {
    const num = parseFloat(warrantsRaw.replace(/,/g, ""));
    warrantValue = isFinite(num) && num >= 0 ? num : null;
  }
  samples.push({
    metricKey: "lc_warrants",
    value: warrantValue,
    observedAt,
    rawText,
    sourceMetadata: { exchange: "GFEX" },
  });

  return samples;
}

export const gfexAdapter: QuotesAdapter = {
  name: "gfex",
  fetch: (ctx: FetchContext) => fetchGfex(ctx),
};

// Export the inner function for testability (allows injecting fetchImpl + now)
export { fetchGfex };
