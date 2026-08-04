import { SourceFetchError } from "@fe-radar/shared";
import type {
  AnnouncementSourceConfig,
  FetchContext,
  StandardItem
} from "../types";
import { fetchTextWithPolicy } from "../http";
import { parsePublishedAt } from "../html";
import type { AnnouncementAdapter } from "./types";

const ENDPOINT =
  "https://bid.powerchina.cn/newcbs/recpro-newmember/BidAnnouncementSummary/list";
const NOTICE_TYPES = {
  tender: { announcementType: "招采公告", bidType: 1, label: "招标公告" },
  purchase: { announcementType: "招采公告", bidType: 0, label: "采购公告" },
  candidate: { announcementType: "中标候选人公示", label: "候选公示" },
  result: { announcementType: "中标/成交公示", label: "中标结果" }
} as const;

type NoticeKind = keyof typeof NOTICE_TYPES;
type PowerChinaRow = {
  id?: unknown;
  title?: unknown;
  titleTypeName?: unknown;
  publishTime?: unknown;
  procuringEntity?: unknown;
  pictureUrl?: unknown;
};
type PowerChinaResponse = { code?: unknown; rows?: unknown };

export function resolvePowerChinaEndpoint(config: AnnouncementSourceConfig) {
  if (typeof config.endpoint !== "string") {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "powerchina-tender endpoint is required"
    );
  }
  let url: URL;
  try {
    url = new URL(config.endpoint);
  } catch {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "powerchina-tender endpoint is invalid"
    );
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "bid.powerchina.cn" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/newcbs/recpro-newmember/BidAnnouncementSummary/list"
  ) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "powerchina-tender endpoint is not allowlisted"
    );
  }
  return ENDPOINT;
}

function uniqueValues(raw: unknown, name: string, max: number): string[] {
  if (!Array.isArray(raw)) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      `powerchina-tender ${name} is required`
    );
  }
  const values = [
    ...new Set(
      raw
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    )
  ];
  if (values.length < 1 || values.length > max) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      `powerchina-tender ${name} must contain 1..${max} values`
    );
  }
  return values;
}

export function validatePowerChinaConfig(config: AnnouncementSourceConfig) {
  const keywords = uniqueValues(config.keywords, "keywords", 20);
  const noticeKinds = uniqueValues(config.noticeKinds, "noticeKinds", 4);
  if (!noticeKinds.every((kind) => kind in NOTICE_TYPES)) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "powerchina-tender noticeKinds is invalid"
    );
  }
  const pageSize = config.pageSize ?? 20;
  if (
    !Number.isInteger(pageSize) ||
    Number(pageSize) < 1 ||
    Number(pageSize) > 20
  ) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "powerchina-tender pageSize must be 1..20"
    );
  }
  return {
    keywords,
    noticeKinds: noticeKinds as NoticeKind[],
    pageSize: Number(pageSize)
  };
}

export function buildPowerChinaBody(
  noticeKind: NoticeKind,
  pageSize: number,
  keyword: string,
  time = Date.now()
) {
  const type = NOTICE_TYPES[noticeKind];
  return {
    pageNum: 1,
    pageSize,
    keyWords: keyword,
    announcementType: type.announcementType,
    companyType: "3",
    ...(noticeKind === "tender" || noticeKind === "purchase"
      ? { bidType: noticeKind === "tender" ? 1 : 0 }
      : {}),
    time
  };
}

function itemUrl(row: PowerChinaRow, id: string, noticeKind: NoticeKind) {
  if (typeof row.pictureUrl === "string") {
    try {
      const url = new URL(row.pictureUrl);
      if (
        url.protocol === "https:" &&
        url.hostname === "bid-zb.powerchina.cn" &&
        !url.port &&
        !url.username &&
        !url.password
      )
        return url.toString();
    } catch {
      // Fall through to the public detail route.
    }
  }
  return `https://bid.powerchina.cn/notice/detail?id=${encodeURIComponent(id)}&type=${encodeURIComponent(NOTICE_TYPES[noticeKind].announcementType)}`;
}

export function mapPowerChinaResponse(
  payload: PowerChinaResponse,
  noticeKind: NoticeKind
): StandardItem[] {
  if (payload.code !== 200 || !Array.isArray(payload.rows)) {
    throw new SourceFetchError(
      "FETCH_PARSE",
      "powerchina-tender response is invalid"
    );
  }
  const items: StandardItem[] = [];
  const seen = new Set<string>();
  for (const row of payload.rows as PowerChinaRow[]) {
    const id = String(row.id ?? "").trim();
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const publishedAt =
      typeof row.publishTime === "string"
        ? parsePublishedAt(row.publishTime)
        : null;
    if (!id || !title || !publishedAt || seen.has(id)) continue;
    seen.add(id);
    const category =
      typeof row.titleTypeName === "string" ? row.titleTypeName.trim() : "";
    const buyer =
      typeof row.procuringEntity === "string" ? row.procuringEntity.trim() : "";
    items.push({
      title,
      url: itemUrl(row, id, noticeKind),
      content: [NOTICE_TYPES[noticeKind].label, category, buyer, title]
        .filter(Boolean)
        .join(" · "),
      publishedAt
    });
  }
  return items;
}

export async function fetchPowerChinaTender(
  config: AnnouncementSourceConfig,
  context: FetchContext,
  fetchImpl?: typeof fetch
) {
  const endpoint = resolvePowerChinaEndpoint(config);
  const { keywords, noticeKinds, pageSize } = validatePowerChinaConfig(config);
  const items: StandardItem[] = [];
  const seen = new Set<string>();

  for (const noticeKind of noticeKinds) {
    for (const keyword of keywords) {
      const raw = await fetchTextWithPolicy(endpoint, {
        timeoutMs: 20_000,
        useRealUa: context.useRealUa,
        maxResponseBytes: 5 * 1024 * 1024,
        source: context.sourceName,
        fetchImpl,
        init: {
          method: "POST",
          headers: { "content-type": "application/json;charset=utf-8" },
          body: JSON.stringify(
            buildPowerChinaBody(noticeKind, pageSize, keyword)
          )
        }
      });
      let payload: PowerChinaResponse;
      try {
        payload = JSON.parse(raw) as PowerChinaResponse;
      } catch {
        throw new SourceFetchError(
          "FETCH_PARSE",
          "powerchina-tender returned invalid JSON"
        );
      }
      for (const item of mapPowerChinaResponse(payload, noticeKind)) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        items.push(item);
      }
    }
  }

  if (items.length === 0) {
    throw new SourceFetchError(
      "FETCH_JSON_EMPTY",
      "powerchina-tender returned no valid items"
    );
  }
  return items;
}

export const powerChinaTenderAdapter: AnnouncementAdapter = {
  name: "powerchina-tender",
  fetch: (context) =>
    fetchPowerChinaTender(
      (context.sourceConfig ?? {}) as AnnouncementSourceConfig,
      context
    )
};
