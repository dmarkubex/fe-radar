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
const DOMESTIC_TIME = /(?:T|\s)(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)\s*$/i;

export function parsePublishedAt(raw: string | null | undefined): Date | null {
  const value = raw?.trim();
  if (!value) return null;

  if (EXPLICIT_TIMEZONE.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const match = DOMESTIC_DATE.exec(value);
  if (!match) return null;
  const time = DOMESTIC_TIME.exec(value);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
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
  const $ = load(html);
  const items: StandardItem[] = [];

  $(config.selectors.item).each((_, element) => {
    const root = $(element);
    const title = firstSelectorMatch(root, config.selectors.title)
      .text()
      .trim();
    const href = firstSelectorMatch(root, config.selectors.link).attr("href");
    const dateText = firstSelectorMatch(root, config.selectors.date)
      .text()
      .trim();
    const content = config.selectors.content
      ? firstSelectorMatch(root, config.selectors.content).text().trim()
      : root.text().trim();
    const publishedAt = parsePublishedAt(dateText);
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
