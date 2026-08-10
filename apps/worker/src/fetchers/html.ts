import { SourceFetchError } from "@fe-radar/shared";
import { load, type Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import type { FetchContext, HtmlSourceConfig, StandardItem } from "./types";
import { fetchTextWithPolicy } from "./http";

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

export function parsePublishedAt(raw: string | null | undefined): Date | null {
  const value = raw?.trim();
  if (!value) return null;

  if (EXPLICIT_TIMEZONE.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
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

  const filtered = config.keywordFilter?.length
    ? items.filter((item) =>
        config.keywordFilter!.some((keyword) =>
          `${item.title} ${item.content}`.includes(keyword)
        )
      )
    : items;
  if (filtered.length === 0) {
    throw new SourceFetchError(
      "FETCH_HTML_EMPTY",
      "HTML selectors returned no items"
    );
  }
  return filtered;
}
