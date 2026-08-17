import { createLogger, SourceFetchError } from "@fe-radar/shared";
import { load, type Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import type { FetchContext, HtmlSourceConfig, StandardItem } from "./types";
import { fetchTextWithPolicy } from "./http";

const logger = createLogger({ service: "fetch-html" });

function firstSelectorMatch(root: Cheerio<AnyNode>, selector: string) {
  const nested = root.find(selector).first();
  return root.is(selector) ? root : nested;
}

const DOMESTIC_DATE =
  /(\d{4})(?:\s*年\s*|[./-])(\d{1,2})(?:\s*月\s*|[./-])(\d{1,2})/;
const US_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
const ENGLISH_DATE =
  /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s*(\d{1,2}),?\s+(\d{4})\b/i;
const ENGLISH_DATE_DAY_FIRST =
  /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{4})\b/i;
const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec"
];
const DOMESTIC_TIME = /(?:T|\s)(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)\s*$/i;
// 相对日期：整串锚定匹配（trim 后必须整个字符串就是"[已知前缀]数字+单位+前/ago"，不允许
// 任何额外字符）。放弃兼容"标题/元数据文本紧贴相对日期"这类混排场景——2026-08-17 核查 16 个
// 生产 html 信源的宽泛选择器实际捕获内容，均为绝对日期或已被上游选择器隔离，未观测到该场景；
// 用户已确认收窄容错范围以终结正则窗口调参的拉锯（见 .ai/reviews/2026-08-17-t-g5-batch6-fix4-reverify-review.md）。
// 副作用：整串锚定天然也堵死了此前登记为 LOW 残留的 Unicode 数字前缀绕过（１000天前 / ١234天前 /
// ¹000天前 等），因为字符串开头若不是空白/已知前缀/[-.]/ASCII 数字，整体匹配直接失败，不再需要
// 单独登记为已知残留。
const RELATIVE_DATE_ZH =
  /^(?:更新于|发布时间|发布于)?\s*[-.]?\s*(\d{1,3})\s*(分钟|小时|天|日)前$/;
const RELATIVE_DATE_EN =
  /^(?:Updated|Posted)?\s*[-.]?\s*(\d{1,3})\s+(minutes?|hours?|days?)\s+ago$/i;
const MAX_RELATIVE_MS = 365 * 86400e3;

export function parsePublishedAt(raw: string | null | undefined): Date | null {
  const value = raw?.trim();
  if (!value) return null;

  if (EXPLICIT_TIMEZONE.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const relativeZh = RELATIVE_DATE_ZH.exec(value);
  const relativeEn = relativeZh ? null : RELATIVE_DATE_EN.exec(value);
  if (relativeZh || relativeEn) {
    const amount = Number((relativeZh ?? relativeEn)![1]);
    const unit = (relativeZh?.[2] ?? relativeEn?.[2]?.toLowerCase()) ?? "";
    const unitMs =
      unit === "分钟" || unit.startsWith("minute")
        ? 60e3
        : unit === "小时" || unit.startsWith("hour")
          ? 3600e3
          : 86400e3;
    const ms = amount * unitMs;
    if (!Number.isFinite(ms) || ms > MAX_RELATIVE_MS) return null;
    return new Date(Date.now() - ms);
  }

  const domestic = DOMESTIC_DATE.exec(value);
  const us = domestic ? null : US_DATE.exec(value);
  const english = domestic || us ? null : ENGLISH_DATE.exec(value);
  const englishDayFirst =
    domestic || us || english ? null : ENGLISH_DATE_DAY_FIRST.exec(value);
  if (!domestic && !us && !english && !englishDayFirst) return null;
  const time = DOMESTIC_TIME.exec(value);
  const year = Number(
    domestic?.[1] ?? us?.[3] ?? english?.[3] ?? englishDayFirst?.[3]
  );
  const englishMonth = english?.[1] ?? englishDayFirst?.[2];
  const month = englishMonth
    ? MONTHS.indexOf(englishMonth.slice(0, 3).toLowerCase()) + 1
    : Number(domestic?.[2] ?? us?.[1]);
  const day = Number(
    domestic?.[3] ?? us?.[2] ?? english?.[2] ?? englishDayFirst?.[1]
  );
  const hour = Number(time?.[1] ?? 0);
  const minute = Number(time?.[2] ?? 0);
  const second = Number(time?.[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  )
    return null;
  return new Date(utc.getTime() - 8 * 60 * 60 * 1000);
}

export async function fetchHtml(
  config: HtmlSourceConfig,
  context: FetchContext,
  fetchImpl?: typeof fetch
): Promise<StandardItem[]> {
  const html = await fetchTextWithPolicy(config.listUrl, {
    timeoutMs: 15_000,
    insecureTLS: config.insecureTLS,
    useRealUa: context.useRealUa,
    maxResponseBytes: 5 * 1024 * 1024,
    source: context.sourceName,
    fetchImpl
  });
  // 阿里云 WAF 挑战页（1b98ad9 误删，恢复）：被拦截时给可操作错误码，而不是 FETCH_HTML_EMPTY。
  if (html.includes("aliyun_waf") || html.includes("acw_sc__v2")) {
    throw new SourceFetchError("FETCH_WAF_CHALLENGE", "page blocked by Aliyun WAF challenge", {
      url: config.listUrl
    });
  }
  const $ = load(html);
  const items: StandardItem[] = [];

  $(config.selectors.item).each((_, element) => {
    const root = $(element);
    const title = firstSelectorMatch(root, config.selectors.title)
      .text()
      .trim();
    const href = firstSelectorMatch(root, config.selectors.link).attr("href");
    const dateText = config.selectors.date
      ? firstSelectorMatch(root, config.selectors.date).text().trim()
      : "";
    const content = config.selectors.content
      ? firstSelectorMatch(root, config.selectors.content).text().trim()
      : root.text().trim();
    // 配了 date selector 才严格校验日期（T-G0-04：防选择器漂移静默产出垃圾时间线）；
    // date:"" 的无日期列表页（bjx 系生产配置即如此，见 0022）回退抓取时间。
    const publishedAt = config.selectors.date ? parsePublishedAt(dateText) : new Date();
    if (!title || !href || !publishedAt) return;
    items.push({
      title,
      url: new URL(href, config.listUrl).toString(),
      content,
      publishedAt
    });
  });

  if (items.length === 0) {
    throw new SourceFetchError(
      "FETCH_HTML_EMPTY",
      "HTML selectors returned no items"
    );
  }
  // 与 rss.ts keywordFilter 语义一致：title + content 包含任一关键词（大小写敏感）才保留。
  const filtered = config.keywordFilter?.length
    ? items.filter((item) =>
        config.keywordFilter!.some((keyword) =>
          `${item.title} ${item.content}`.includes(keyword)
        )
      )
    : items;
  // keywordFilter 收窄导致 0 条是业务空窗，不是抓取故障。抛 SourceFetchError
  // 会被 fetch.ts 计入 fail_count，连续命中会自动禁用生产 html 源（698/719/720/
  // 730/731/732 均 enabled + keywordFilter）。选择器本身 0 条仍走上方 FETCH_HTML_EMPTY。
  if (filtered.length === 0) {
    logger.debug(
      {
        source: context.sourceName,
        keywords: config.keywordFilter,
        total: items.length
      },
      "HTML items all filtered out by keywordFilter"
    );
    return [];
  }
  return filtered;
}
