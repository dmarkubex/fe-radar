/**
 * RSSHub numeric-extract quotes adapter
 *
 * 通用 RSSHub 数值抽取 adapter：
 * - 从 RSSHub RSS XML 的第一条 item description / title 用正则提取数值
 * - 配置驱动：sourceConfig.regex_rules 数组，逐条尝试匹配
 * - 正则未命中 → value=null + rawText 保留，禁止 LLM fallback（NFR-102）
 * - raw_text strip HTML + 截断 ≤2000 字符
 * - 走 RSSHUB_BASE_URL env + sourceConfig.endpoint（相对路径）或绝对 endpoint
 *
 * NFR-102 硬约束：禁止 LLM 调用；未命中 value=null
 * NFR-104：命中失败连续 3 日 → 由上层 quotes-fetch 计入 fail_count/admin 告警入口
 */

import * as cheerio from "cheerio";
import Parser from "rss-parser";
import { fetchTextWithPolicy } from "../http";
import type { FetchContext } from "../types";
import type { QuotesAdapter, QuoteSample } from "./types";

/**
 * A single regex rule from sources.config.regex_rules.
 */
interface RegexRule {
  /** RegExp source pattern (no flags; case-insensitive applied automatically) */
  pattern: string;
  /** Capture group index to extract (1-based) */
  group?: number;
  /** The metric_key to use for this match. */
  metric_key?: string;
  /** Optional numeric multiplier for unit conversion (e.g. 10000 for 万元→元) */
  unit_multiplier?: number;
  /** Backward-compatible legacy fields from early agent commits. */
  metricKey?: string;
  key?: string;
  multiplier?: number;
}

const rssParser = new Parser();

/**
 * Strip all HTML tags from input string and truncate to ≤2000 Unicode code points.
 * Uses cheerio's text extraction (already a dep; no new packages).
 */
function stripAndTruncate(html: string): string {
  const $ = cheerio.load(html);
  const text = $.text().replace(/\s+/g, " ").trim();
  const codePoints = Array.from(text);
  return codePoints.length > 2000
    ? codePoints.slice(0, 2000).join("")
    : text;
}

/**
 * Try each regex_rule in order against the given text.
 * Returns the first match or null.
 */
function applyRegexRules(
  text: string,
  rules: RegexRule[]
): { metricKey: string; value: number } | null {
  for (const rule of rules) {
    try {
      const re = new RegExp(rule.pattern, "i");
      const match = re.exec(text);
      if (!match) continue;

      const groupIndex = rule.group ?? 1;
      const raw = match[groupIndex];
      if (raw === undefined) continue;

      const num = parseFloat(raw.replace(/,/g, ""));
      if (isNaN(num)) continue;

      const metricKey = rule.metric_key ?? rule.metricKey ?? rule.key ?? "unknown";
      const multiplier = rule.unit_multiplier ?? rule.multiplier ?? 1;
      return { metricKey, value: num * multiplier };
    } catch {
      // Malformed regex — skip rule
      continue;
    }
  }
  return null;
}

function buildRsshubUrl(endpoint: string): string {
  try {
    return new URL(endpoint).toString();
  } catch {
    const baseUrl =
      (process.env["RSSHUB_BASE_URL"] ?? "http://rsshub:1200").replace(
        /\/$/,
        ""
      );
    const relative = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    return new URL(relative, `${baseUrl}/`).toString();
  }
}

function firstMetricKey(config: Record<string, unknown>, regexRules: RegexRule[]): string {
  const configured = config["metric_key"];
  if (typeof configured === "string" && configured.length > 0) return configured;

  const metricKeys = config["metric_keys"];
  if (Array.isArray(metricKeys) && typeof metricKeys[0] === "string") {
    return metricKeys[0];
  }

  return regexRules[0]?.metric_key ?? regexRules[0]?.metricKey ?? regexRules[0]?.key ?? "unknown";
}

export const rsshubExtractAdapter: QuotesAdapter = {
  name: "rsshub-extract",

  async fetch(ctx: FetchContext): Promise<QuoteSample[]> {
    const config = ctx.sourceConfig ?? {};
    const endpoint = config["endpoint"] as string | undefined;
    const regexRules = (config["regex_rules"] as RegexRule[] | undefined) ?? [];

    if (!endpoint) {
      // Cannot proceed without an endpoint; return [] per contract
      return [];
    }

    const fullUrl = buildRsshubUrl(endpoint);

    try {
      const xml = await fetchTextWithPolicy(fullUrl, {
        timeoutMs: 8000,
        useRealUa: false, // RSSHub is internal; no UA rotation needed
      });

      const feed = await rssParser.parseString(xml);
      const results: QuoteSample[] = [];

      for (const item of feed.items) {
        // Build the combined text to search: description (HTML) + title
        const descriptionHtml = item.content ?? item.contentSnippet ?? item["content:encoded"] ?? "";
        const titleText = item.title ?? "";
        const combinedHtml = `${descriptionHtml} ${titleText}`;

        // Strip HTML for rawText (also used for regex matching)
        const plainText = stripAndTruncate(combinedHtml);
        const rawText = plainText;

        // Try to extract value via regex_rules
        const observedAt = item.isoDate
          ? new Date(item.isoDate)
          : item.pubDate
            ? new Date(item.pubDate)
            : new Date();

        if (regexRules.length === 0) {
          // No rules configured — emit null value sample
          results.push({
            metricKey: firstMetricKey(config, regexRules),
            value: null,
            observedAt,
            rawText,
          });
          continue;
        }

        const matched = applyRegexRules(plainText, regexRules);

        results.push({
          metricKey: matched?.metricKey ?? firstMetricKey(config, regexRules),
          value: matched?.value ?? null,
          observedAt,
          rawText,
        });
      }

      return results;
    } catch {
      // Adapter must return [] on failure, never throw (QuotesAdapter contract)
      return [];
    }
  },
};
