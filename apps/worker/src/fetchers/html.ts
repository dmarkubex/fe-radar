import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";
import type { Element } from "domhandler";
import { SourceFetchError } from "@fe-radar/shared";
import { fetchTextWithPolicy } from "./http";
import type { FetchContext, HtmlSourceConfig, StandardItem } from "./types";

function firstSelectorMatch(root: Cheerio<Element>, selector: string): Cheerio<Element> {
  const nested = root.find(selector).first();
  if (nested.length > 0) return nested;
  return root.is(selector) ? root : nested;
}

export async function fetchHtml(config: HtmlSourceConfig, context: FetchContext, fetchImpl?: typeof fetch): Promise<StandardItem[]> {
  const html = await fetchTextWithPolicy(config.listUrl, { timeoutMs: 5000, useRealUa: context.useRealUa, fetchImpl });
  const $ = cheerio.load(html);
  const items: StandardItem[] = [];

  $(config.selectors.item).each((_, element) => {
    const root = $(element) as Cheerio<Element>;
    const titleElement = firstSelectorMatch(root, config.selectors.title);
    const linkElement = firstSelectorMatch(root, config.selectors.link);
    const title = titleElement.text().trim();
    const href = linkElement.attr("href");
    const dateText = root.find(config.selectors.date).first().text().trim();
    const content = config.selectors.content ? root.find(config.selectors.content).first().text().trim() : title;

    if (!title || !href) {
      return;
    }

    items.push({
      title,
      url: new URL(href, config.listUrl).toString(),
      content,
      publishedAt: dateText ? new Date(dateText) : new Date()
    });
  });

  if (items.length === 0) {
    throw new SourceFetchError("FETCH_HTML_EMPTY", "HTML selectors matched no items", { source: context.sourceName });
  }

  return items;
}
