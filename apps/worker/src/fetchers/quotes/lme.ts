import * as cheerio from "cheerio";
import { fetchTextWithPolicy } from "../http";
import type { FetchContext } from "../types";
import type { QuotesAdapter, QuoteSample } from "./types";

/**
 * LME 伦铜延迟数据适配器
 *
 * Endpoint: https://www.lme.com/en/metals/non-ferrous/lme-copper#tabIndex=1
 * 解析 HTML 表格中 Copper 行的 3-months Seller 价格（USD/吨）。
 *
 * 产出 metrics:
 *   lme_cu_3m  — LME 铜 3 个月合约卖价（USD/吨）
 *
 * NFR-102: 禁止 LLM 抽取数值；解析失败 value=null 保留 rawText。
 */

const LME_ENDPOINT =
  "https://www.lme.com/en/metals/non-ferrous/lme-copper#tabIndex=1";

/** Strip HTML tags and truncate to ≤2000 Unicode code points (NFR-102 / FR-12). */
function toRawText(text: string): string {
  const stripped = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const codePoints = [...stripped];
  return codePoints.length > 2000 ? codePoints.slice(0, 2000).join("") : stripped;
}

/**
 * Parse the LME delayed-price HTML table and extract the copper 3-month seller price.
 *
 * The table has columns in order:
 *   Metal | Prompt Date | Cash Buyer | Cash Seller | 3-months Buyer | 3-months Seller | ...
 *
 * We look for the row with data-metal="copper" or whose first cell text is "Copper".
 * We use the `.three-month-seller` cell class if present; otherwise fall back to column index 5.
 */
function parseLmeHtml(html: string): number | null {
  const $ = cheerio.load(html);

  // Try data-metal="copper" row first
  let row = $('tr[data-metal="copper"]');
  if (row.length === 0) {
    // Fallback: find row whose first td text matches "Copper" (case-insensitive)
    $("tbody tr").each((_, el) => {
      const firstCell = $(el).find("td").first().text().trim().toLowerCase();
      if (firstCell === "copper") {
        row = $(el);
        return false; // break
      }
    });
  }

  if (row.length === 0) return null;

  // Try named class first
  const namedCell = row.find(".three-month-seller");
  const cellText = namedCell.length > 0
    ? namedCell.text().trim()
    : row.find("td").eq(5).text().trim();

  if (!cellText) return null;

  const num = parseFloat(cellText.replace(/,/g, ""));
  return isFinite(num) && num > 0 ? num : null;
}

async function fetchLme(
  ctx: FetchContext,
  now: Date = new Date(),
  fetchImpl?: typeof fetch
): Promise<QuoteSample[]> {
  const observedAt = now;

  let rawBody: string;
  try {
    rawBody = await fetchTextWithPolicy(LME_ENDPOINT, {
      timeoutMs: 10000,
      useRealUa: ctx.useRealUa ?? true,
      fetchImpl,
    });
  } catch {
    // Network failure → return empty (adapter contract: never throw)
    return [];
  }

  const rawText = toRawText(rawBody);
  const value = parseLmeHtml(rawBody);

  return [
    {
      metricKey: "lme_cu_3m",
      value,
      observedAt,
      rawText,
      sourceMetadata: { exchange: "LME", contract: "3M" },
    },
  ];
}

export const lmeAdapter: QuotesAdapter = {
  name: "lme",
  fetch: (ctx: FetchContext) => fetchLme(ctx),
};

// Export the inner function for testability (allows injecting fetchImpl + now)
export { fetchLme };
