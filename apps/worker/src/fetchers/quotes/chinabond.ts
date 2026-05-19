/**
 * ChinaBond quotes adapter — 中国货币网 10 年期国债收益率
 *
 * NFR-102 硬约束：
 * - 禁止 LLM 调用；数值必须从 HTML 解析
 * - 解析失败 → value=null + rawText 保留（strip HTML + 截断 ≤2000 字符）
 * - 走 v1.0 http.ts + robots + UA 池
 */

import * as cheerio from "cheerio";
import { fetchTextWithPolicy } from "../http";
import type { FetchContext } from "../types";
import type { QuotesAdapter, QuoteSample } from "./types";

/** 中国货币网国债收益率曲线页面默认 URL（sources.config.endpoint 可覆盖）*/
const DEFAULT_ENDPOINT =
  "https://www.chinamoney.com.cn/chinese/bkccpr/";

/**
 * strip HTML tags and truncate to ≤2000 Unicode code points.
 */
function sanitizeRawText(html: string): string {
  const $ = cheerio.load(html);
  const text = $.text().replace(/\s+/g, " ").trim();
  const codePoints = Array.from(text);
  return codePoints.length > 2000
    ? codePoints.slice(0, 2000).join("")
    : text;
}

/**
 * Parse chinamoney.com.cn HTML for 10Y CNY bond yield.
 * Looks for:
 * 1. An element with id="yield-10y" (our fixture pattern)
 * 2. A table row containing "10年" with a numeric yield in the adjacent cell
 * Returns null if the yield cannot be found.
 */
function parseChinabondYield(
  html: string
): { value: number | null; observedAt: Date } {
  const $ = cheerio.load(html);

  let observedAt = new Date();
  const dateText = $(".publish_time, .time, .date").first().text().trim();
  if (dateText) {
    const parsed = new Date(dateText);
    if (!isNaN(parsed.getTime())) {
      observedAt = parsed;
    }
  }

  let value: number | null = null;

  // Strategy 1: direct id selector (our fixture + some page structures)
  const yieldEl = $("#yield-10y").first();
  if (yieldEl.length) {
    const parsed = parseFloat(yieldEl.text().trim().replace(/,/g, ""));
    if (!isNaN(parsed) && parsed > 0) {
      value = parsed;
    }
  }

  // Strategy 2: search table rows for "10年" pattern
  if (value === null) {
    $("table tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 2) return;

      const firstCell = $(cells[0]).text().trim();
      if (!firstCell.includes("10年") && !firstCell.includes("10Y")) {
        return;
      }

      const rateText = $(cells[1]).text().trim();
      const parsed = parseFloat(rateText.replace(/,/g, ""));
      if (!isNaN(parsed) && parsed > 0) {
        value = parsed;
      }
    });
  }

  return { value, observedAt };
}

export const chinabondAdapter: QuotesAdapter = {
  name: "chinabond",

  async fetch(ctx: FetchContext): Promise<QuoteSample[]> {
    const endpoint =
      (ctx.sourceConfig?.["endpoint"] as string | undefined) ??
      DEFAULT_ENDPOINT;

    try {
      const html = await fetchTextWithPolicy(endpoint, {
        timeoutMs: 8000,
        useRealUa: ctx.useRealUa ?? true,
      });

      const rawText = sanitizeRawText(html);
      const { value, observedAt } = parseChinabondYield(html);

      return [
        {
          metricKey: "cny_10y_yield",
          value,
          observedAt,
          rawText,
        },
      ];
    } catch {
      // Adapter must return [] on failure, never throw (QuotesAdapter contract)
      return [];
    }
  },
};
