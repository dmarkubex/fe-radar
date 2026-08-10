/**
 * RSSHub numeric-extract quotes adapter
 *
 * 通用 RSSHub 数值抽取 adapter：
 * - 遍历 RSS feed.items，找第一个 regex 命中的 item 作为 winner，emit 单一 QuoteSample
 * - 全部 item 未命中 → emit 单一 null 样本（保留 items[0] 的 raw_text 给审计）
 * - 配置驱动：sourceConfig.regex_rules 数组，逐条尝试匹配
 * - 正则未命中 → value=null + rawText 保留，禁止 LLM fallback（NFR-102）
 * - raw_text strip HTML + 截断 ≤2000 字符
 * - 走 RSSHUB_BASE_URL env + sourceConfig.endpoint（相对路径）或绝对 endpoint
 *
 * NFR-102 硬约束：禁止 LLM 调用；未命中 value=null
 * NFR-104：命中失败连续 3 日 → 由上层 quotes-fetch 计入 fail_count/admin 告警入口
 *
 * 单样本策略（[T-CB-08-FIX2] 修正全 item 遍历污染 commodity_quotes，DMA-163 + Antigravity REJECTED）：
 * 不取 feed.items[0]（首条可能是非价格突发新闻），改用首匹配 winner，跳过无关 item。
 */

import * as cheerio from "cheerio";
import Parser from "rss-parser";
import RE2 from "re2";
import { fetchTextWithPolicy } from "../http";
import type { FetchContext } from "../types";
import type { QuotesAdapter, QuoteSample } from "./types";
import { createLogger } from "@fe-radar/shared";

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
/**
 * A regex rule compiled once per fetch (RE2 instance reused across all items).
 * B-1: previously RE2 was re-compiled inside the item loop for every item × rule,
 * leaking native memory that JS GC cannot reclaim (5000 item×20 rule → RSS
 * 131 MB, never released).
 */
interface CompiledRule {
  metricKey: string;
  re: RE2;
  group: number;
  multiplier: number;
}

const rssParser = new Parser();

const logger = createLogger({ service: "rsshub-extract" });

// T4 / A-1: 用 RE2（线性时间引擎，不做回溯）替代 Node RegExp，从架构上消除
// 灾难性回溯 ReDoS。编辑员可配 pattern 曾能锁死 worker 事件循环 66s；静态检测器
// 连续三轮被绕过。RE2 不支持的语法（前后瞻/反向引用）在构造时抛错 → 跳过该规则。
// 与 schema 对齐的长度上限仍保留，防止异常超长 pattern 占用编译内存。
const REGEX_PATTERN_MAX_LEN = 200;

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
 * Compile all regex_rules ONCE before iterating feed items.
 * Invalid / unsupported patterns (lookahead, backrefs, …) and over-length
 * patterns are warned and skipped HERE — each at most once per fetch — not
 * repeatedly inside the item loop.
 *
 * B-1: moves `new RE2(…)` out of the per-item loop so native RE2 memory is
 * allocated exactly once per rule per fetch.  Previously 5 000 items × 20 rules
 * = 100 000 RE2 constructions leaked ~75 MB of native memory the JS GC cannot
 * reclaim.
 *
 * T4: RE2 is a linear-time engine (no backtracking) — patterns that could lock
 * the event loop under Node RegExp return instantly or fail at compile time.
 */
function compileRegexRules(rules: RegexRule[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const rule of rules) {
    const metricKey =
      rule.metric_key ?? rule.metricKey ?? rule.key ?? "unknown";

    if (rule.pattern.length > REGEX_PATTERN_MAX_LEN) {
      logger.warn(
        { pattern: rule.pattern, metric_key: metricKey },
        "skipping regex rule: pattern exceeds max length"
      );
      continue;
    }

    try {
      compiled.push({
        metricKey,
        re: new RE2(rule.pattern, "i"),
        group: rule.group ?? 1,
        multiplier: rule.unit_multiplier ?? rule.multiplier ?? 1,
      });
    } catch (err) {
      logger.warn(
        {
          pattern: rule.pattern,
          metric_key: metricKey,
          err: err instanceof Error ? err.message : String(err),
        },
        "skipping regex rule: RE2 compile failed (unsupported or invalid pattern)"
      );
    }
  }
  return compiled;
}

/**
 * Try each **pre-compiled** rule in order against the given text.
 * Returns the first match or null.
 *
 * B-1: receives CompiledRule[] (RE2 instances compiled once in compileRegexRules).
 * No `new RE2(…)` here — the item loop allocates zero native memory.
 */
function applyRegexRules(
  text: string,
  rules: CompiledRule[]
): { metricKey: string; value: number } | null {
  for (const rule of rules) {
    const match = rule.re.exec(text);
    if (!match) continue;

    const raw = match[rule.group];
    if (raw === undefined) continue;

    const num = parseFloat(raw.replace(/,/g, ""));
    if (isNaN(num)) continue;

    return { metricKey: rule.metricKey, value: num * rule.multiplier };
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
    // T-SEC-10: 运行时纵深防御 —— 限制 rule 数量（schema 侧已限 20，这里兜底防绕过）。
    const regexRules = ((config["regex_rules"] as RegexRule[] | undefined) ?? []).slice(0, 20);

    if (!endpoint) {
      // Cannot proceed without an endpoint; return [] per contract
      return [];
    }

    const fullUrl = buildRsshubUrl(endpoint);

    try {
      const xml = await fetchTextWithPolicy(fullUrl, {
        timeoutMs: 8000,
        useRealUa: false, // RSSHub is internal; no UA rotation needed
        // T-SEC-07: quotes feed 更小，1MB 上限足够且能阻断超大响应耗尽内存。
        maxResponseBytes: 1024 * 1024,
      });

      const feed = await rssParser.parseString(xml);

      // Empty feed → no sample
      if (!feed.items || feed.items.length === 0) {
        return [];
      }

      const itemObservedAt = (item: (typeof feed.items)[number]): Date => {
        return item.isoDate
          ? new Date(item.isoDate)
          : item.pubDate
            ? new Date(item.pubDate)
            : new Date();
      };

      const itemPlainText = (item: (typeof feed.items)[number]): string => {
        const descriptionHtml =
          item.content ?? item.contentSnippet ?? item["content:encoded"] ?? "";
        const titleText = item.title ?? "";
        return stripAndTruncate(`${descriptionHtml} ${titleText}`);
      };

      // Single-sample emission: scan items for the first regex winner.
      // If no rules configured OR no items match, emit one null sample using
      // feed.items[0]'s rawText for audit (NFR-102 raw_text 保留契约)。
      if (regexRules.length === 0) {
        const firstItem = feed.items[0]!;
        return [
          {
            metricKey: firstMetricKey(config, regexRules),
            value: null,
            observedAt: itemObservedAt(firstItem),
            rawText: itemPlainText(firstItem),
          },
        ];
      }

      // B-1: compile regex rules ONCE before iterating items — RE2 native memory
      // is allocated per-rule, not per-item×rule.  Bad rules warn once here.
      const compiledRules = compileRegexRules(regexRules);

      for (const item of feed.items) {
        const plainText = itemPlainText(item);
        const matched = applyRegexRules(plainText, compiledRules);
        if (matched) {
          return [
            {
              metricKey: matched.metricKey,
              value: matched.value,
              observedAt: itemObservedAt(item),
              rawText: plainText,
            },
          ];
        }
      }

      // No item matched — emit one null sample anchored to items[0]
      const firstItem = feed.items[0]!;
      return [
        {
          metricKey: firstMetricKey(config, regexRules),
          value: null,
          observedAt: itemObservedAt(firstItem),
          rawText: itemPlainText(firstItem),
        },
      ];
    } catch {
      // Adapter must return [] on failure, never throw (QuotesAdapter contract)
      return [];
    }
  },
};
