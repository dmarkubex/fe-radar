import { fetchTextWithPolicy } from "../http";
import type { FetchContext } from "../types";
import type { QuotesAdapter, QuoteSample } from "./types";

/**
 * 上期所（SHFE）沪铜主力合约适配器
 *
 * Endpoint: http://www.shfe.com.cn/data/dailydata/kx/kx{YYYYMMDD}.dat
 * 返回当日全品种日行情 JSON（.dat 后缀，实际为 JSON）。
 *
 * 产出 metrics:
 *   cu_main_close   — 主力合约收盘价（元/吨）
 *   cu_warrants     — 铜仓单数量（手）
 *
 * NFR-102: 禁止 LLM 抽取数值；无有效行情日期时返回空数组。
 */

const SHFE_ENDPOINT_TEMPLATE =
  "http://www.shfe.com.cn/data/dailydata/kx/kx{YYYYMMDD}.dat";

interface ShfeInstrument {
  INSTRUMENTID: string;
  PRODUCTSORTNO: number;
  CLOSEPRICE?: string;
  SETTLEMENTPRICE?: string;
}

interface ShfeWarrant {
  PRODUCTID: string;
  WRHOUSEQUANTITY?: string;
}

interface ShfeDat {
  o_curinstrument?: ShfeInstrument[];
  o_curwarrant?: ShfeWarrant[];
}

/** Format a Date as YYYYMMDD in Asia/Shanghai timezone. */
function formatShanghai(date: Date): string {
  // Use explicit offset components to avoid Intl dependency issues in test env.
  const offsetMs = 8 * 60 * 60 * 1000;
  const local = new Date(date.getTime() + offsetMs);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** Strip HTML tags and truncate to ≤2000 Unicode code points (NFR-102 / FR-12). */
function toRawText(text: string): string {
  const stripped = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const codePoints = [...stripped];
  return codePoints.length > 2000 ? codePoints.slice(0, 2000).join("") : stripped;
}

/**
 * Pick the main-contract instrument: PRODUCTSORTNO=10 for copper (cu).
 * Falls back to first instrument with INSTRUMENTID starting with "cu".
 */
function pickMainContract(instruments: ShfeInstrument[]): ShfeInstrument | undefined {
  const cuInstruments = instruments.filter(
    (inst) => inst.INSTRUMENTID.trim().toLowerCase().startsWith("cu")
  );
  if (cuInstruments.length === 0) return undefined;
  const sorted = cuInstruments.slice().sort((a, b) => a.PRODUCTSORTNO - b.PRODUCTSORTNO);
  return sorted[0];
}

async function fetchShfe(
  ctx: FetchContext,
  now: Date = new Date(),
  fetchImpl?: typeof fetch
): Promise<QuoteSample[]> {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  for (let daysBack = 0; daysBack < 5; daysBack += 1) {
    const candidateDate = new Date(now.getTime() - daysBack * MS_PER_DAY);
    const dateStr = formatShanghai(candidateDate);
    const url = SHFE_ENDPOINT_TEMPLATE.replace("{YYYYMMDD}", dateStr);

    let rawBody: string;
    try {
      rawBody = await fetchTextWithPolicy(url, {
        timeoutMs: 8000,
        useRealUa: ctx.useRealUa ?? true,
        fetchImpl,
      });
    } catch {
      continue;
    }

    let parsed: ShfeDat;
    try {
      parsed = JSON.parse(rawBody) as ShfeDat;
    } catch {
      continue;
    }

    if (!parsed.o_curinstrument || parsed.o_curinstrument.length === 0) {
      continue;
    }

    const observedAt = candidateDate;
    const rawText = toRawText(rawBody);
    const samples: QuoteSample[] = [];

    // cu_main_close
    const instruments = parsed.o_curinstrument;
    const mainContract = pickMainContract(instruments);
    let closeValue: number | null = null;
    if (mainContract) {
      const raw = mainContract.CLOSEPRICE ?? mainContract.SETTLEMENTPRICE ?? "";
      const parsed_num = parseFloat(raw.replace(/,/g, ""));
      closeValue = isFinite(parsed_num) && parsed_num > 0 ? parsed_num : null;
    }
    samples.push({
      metricKey: "cu_main_close",
      value: closeValue,
      observedAt,
      rawText,
      sourceMetadata: mainContract
        ? { instrumentId: mainContract.INSTRUMENTID.trim(), exchange: "SHFE" }
        : { exchange: "SHFE" },
    });

    // cu_warrants
    const warrants = parsed.o_curwarrant ?? [];
    const cuWarrant = warrants.find(
      (w) => w.PRODUCTID.trim().toLowerCase() === "cu"
    );
    let warrantValue: number | null = null;
    if (cuWarrant?.WRHOUSEQUANTITY !== undefined) {
      const parsed_num = parseFloat(cuWarrant.WRHOUSEQUANTITY.replace(/,/g, ""));
      warrantValue = isFinite(parsed_num) && parsed_num >= 0 ? parsed_num : null;
    }
    samples.push({
      metricKey: "cu_warrants",
      value: warrantValue,
      observedAt,
      rawText,
      sourceMetadata: { exchange: "SHFE" },
    });

    return samples;
  }

  return [];
}

export const shfeAdapter: QuotesAdapter = {
  name: "shfe",
  fetch: (ctx: FetchContext) => fetchShfe(ctx),
};

// Export the inner function for testability (allows injecting fetchImpl + now)
export { fetchShfe };
