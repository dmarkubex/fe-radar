import { SourceFetchError } from "@fe-radar/shared";
import { load } from "cheerio";
import type {
  AnnouncementSourceConfig,
  FetchContext,
  StandardItem
} from "../types";
import { fetchTextWithPolicy } from "../http";
import { parsePublishedAt } from "../html";
import type { AnnouncementAdapter } from "./types";

const ENDPOINT = "https://www.chnenergybidding.com.cn/bidweb/";
const NOTICE_LABELS = {
  tender: "招标公告",
  purchase: "采购公告",
  candidate: "候选公示",
  result: "中标结果"
} as const;
type NoticeKind = keyof typeof NOTICE_LABELS;

export function resolveChnEnergyEndpoint(config: AnnouncementSourceConfig) {
  if (typeof config.endpoint !== "string") {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "chnenergy-tender endpoint is required"
    );
  }
  let url: URL;
  try {
    url = new URL(config.endpoint);
  } catch {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "chnenergy-tender endpoint is invalid"
    );
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.chnenergybidding.com.cn" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/bidweb/"
  ) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "chnenergy-tender endpoint is not allowlisted"
    );
  }
  return ENDPOINT;
}

function values(
  config: AnnouncementSourceConfig,
  key: "keywords" | "noticeKinds"
) {
  const raw = config[key];
  if (!Array.isArray(raw)) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      `chnenergy-tender ${key} is required`
    );
  }
  const cleaned = [
    ...new Set(
      raw
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    )
  ];
  const max = key === "keywords" ? 20 : 4;
  if (cleaned.length < 1 || cleaned.length > max) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      `chnenergy-tender ${key} must contain 1..${max} values`
    );
  }
  return cleaned;
}

function classify(title: string): NoticeKind | null {
  if (/中标候选人公示/.test(title)) return "candidate";
  if (/(中标|成交)结果(公告|公示)/.test(title)) return "result";
  if (/(招标公告|资格预审公告)/.test(title)) return "tender";
  if (/(采购公告|公开询价|竞价采购)/.test(title)) return "purchase";
  return null;
}

export function parseChnEnergyHtml(
  html: string,
  keywords: string[],
  noticeKinds: NoticeKind[]
): StandardItem[] {
  const $ = load(html);
  const items: StandardItem[] = [];
  const seen = new Set<string>();
  $("li.tab2-item").each((_, element) => {
    const root = $(element);
    const link = root.find("a.infolink[title]").last();
    const title = (link.attr("title") ?? link.text()).trim();
    const href = link.attr("href");
    const kind = classify(title);
    if (
      !href ||
      !kind ||
      !noticeKinds.includes(kind) ||
      !keywords.some((keyword) => title.includes(keyword))
    )
      return;
    const match = /\/(20\d{2})(\d{2})(\d{2})\//.exec(href);
    const publishedAt = match
      ? parsePublishedAt(`${match[1]}-${match[2]}-${match[3]}`)
      : null;
    if (!publishedAt) return;
    const parsedUrl = new URL(href, ENDPOINT);
    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.hostname !== "www.chnenergybidding.com.cn" ||
      !parsedUrl.pathname.startsWith("/bidweb/")
    )
      return;
    const url = parsedUrl.toString();
    if (seen.has(url)) return;
    seen.add(url);
    items.push({
      title,
      url,
      content: `${NOTICE_LABELS[kind]} · ${title}`,
      publishedAt
    });
  });
  return items;
}

export async function fetchChnEnergyTender(
  config: AnnouncementSourceConfig,
  context: FetchContext,
  fetchImpl?: typeof fetch
) {
  const endpoint = resolveChnEnergyEndpoint(config);
  const keywords = values(config, "keywords");
  const noticeKinds = values(config, "noticeKinds");
  if (!noticeKinds.every((kind) => kind in NOTICE_LABELS)) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "chnenergy-tender noticeKinds is invalid"
    );
  }
  const html = await fetchTextWithPolicy(endpoint, {
    timeoutMs: 20_000,
    useRealUa: context.useRealUa,
    maxResponseBytes: 2 * 1024 * 1024,
    source: context.sourceName,
    fetchImpl
  });
  const items = parseChnEnergyHtml(html, keywords, noticeKinds as NoticeKind[]);
  if (items.length === 0) {
    throw new SourceFetchError(
      "FETCH_HTML_EMPTY",
      "chnenergy-tender returned no valid items"
    );
  }
  return items;
}

export const chnEnergyTenderAdapter: AnnouncementAdapter = {
  name: "chnenergy-tender",
  fetch: (context) =>
    fetchChnEnergyTender(
      (context.sourceConfig ?? {}) as AnnouncementSourceConfig,
      context
    )
};
