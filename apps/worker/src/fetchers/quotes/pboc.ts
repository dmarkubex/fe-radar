/**
 * PBOC quotes adapter — 中国人民银行人民币兑美元汇率中间价
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

/** PBOC 汇率中间价页面默认 URL（sources.config.endpoint 可覆盖）*/
const DEFAULT_ENDPOINT =
  "https://www.pbc.gov.cn/rmyh/108976/index.html";

/**
 * strip HTML tags and truncate to ≤2000 Unicode code points.
 * Uses cheerio text extraction (no new deps).
 */
function sanitizeRawText(html: string): string {
  const $ = cheerio.load(html);
  const text = $.text().replace(/\s+/g, " ").trim();
  // Truncate to 2000 Unicode code points (Array.from handles surrogate pairs)
  const codePoints = Array.from(text);
  return codePoints.length > 2000
    ? codePoints.slice(0, 2000).join("")
    : text;
}

/**
 * Parse PBOC exchange rate HTML.
 * Looks for a table row containing "美元" and extracts the numeric rate.
 * Returns null if the rate cannot be found.
 */
function parsePbocRate(
  html: string
): { value: number | null; observedAt: Date } {
  const $ = cheerio.load(html);

  // Try to extract the publish date from the page
  let observedAt = new Date();
  const dateText = $(".publish_time, .time, .date").first().text().trim();
  if (dateText) {
    const parsed = new Date(dateText);
    if (!isNaN(parsed.getTime())) {
      observedAt = parsed;
    }
  }

  // Search for the USD row: look for "美元" text in a table cell
  let value: number | null = null;

  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;

    const firstCell = $(cells[0]).text().trim();
    if (!firstCell.includes("美元") && !firstCell.toUpperCase().includes("USD")) {
      return;
    }

    // The rate is typically in the second cell (index 1) or a cell with class 'rate'
    const rateCell = $(row).find("td.rate").first();
    const rateText = rateCell.length
      ? rateCell.text().trim()
      : $(cells[1]).text().trim();

    const parsed = parseFloat(rateText.replace(/,/g, ""));
    if (!isNaN(parsed) && parsed > 0) {
      value = parsed;
    }
  });

  return { value, observedAt };
}

export const pbocAdapter: QuotesAdapter = {
  name: "pboc",

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
      const { value, observedAt } = parsePbocRate(html);

      return [
        {
          metricKey: "fx_usdcny",
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
