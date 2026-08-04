import { SourceFetchError } from "@fe-radar/shared";
import type {
  AnnouncementSourceConfig,
  FetchContext,
  StandardItem
} from "../types";
import { fetchTextWithPolicy } from "../http";
import { parsePublishedAt } from "../html";
import type { AnnouncementAdapter } from "./types";

const ENDPOINT = "https://ecp.sgcc.com.cn/ecp2.0/ecpwcmcore/index/noteList";
const ITEM_URL = "https://ecp.sgcc.com.cn/ecp2.0/portal/#/doc/doc-com/";
const MENU_IDS = {
  tender: "2018032700291334",
  purchase: "2018032900295987",
  candidate: "2018060501171107",
  result: "2018060501171111"
} as const;
const LABELS = {
  tender: "招标公告",
  purchase: "采购公告",
  candidate: "候选公示",
  result: "中标公告"
} as const;

type NoticeKind = keyof typeof MENU_IDS;
type SgccConfig = {
  endpoint?: unknown;
  keywords?: unknown;
  noticeKinds?: unknown;
  pageSize?: unknown;
};
type SgccRow = {
  firstPageDocId?: unknown;
  title?: unknown;
  publishOrgName?: unknown;
  noticePublishTime?: unknown;
};
type SgccResponse = {
  successful?: unknown;
  resultValue?: { noteList?: unknown };
};

export function resolveSgccTenderEndpoint(config: AnnouncementSourceConfig) {
  if (typeof config.endpoint !== "string") {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "sgcc-tender endpoint is required"
    );
  }
  let url: URL;
  try {
    url = new URL(config.endpoint.trim());
  } catch {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "sgcc-tender endpoint is invalid"
    );
  }
  const path = url.pathname.replace(/\/{2,}/g, "/");
  if (
    url.protocol !== "https:" ||
    url.hostname !== "ecp.sgcc.com.cn" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    path !== "/ecp2.0/ecpwcmcore/index/noteList"
  ) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "sgcc-tender endpoint is not allowlisted"
    );
  }
  return ENDPOINT;
}

function uniqueStrings(raw: unknown, name: string, max: number): string[] {
  if (!Array.isArray(raw)) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      `sgcc-tender ${name} is required`
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
      `sgcc-tender ${name} must contain 1..${max} values`
    );
  }
  return values;
}

export function validateSgccTenderConfig(config: AnnouncementSourceConfig) {
  const raw = config as SgccConfig;
  const keywords = uniqueStrings(raw.keywords, "keywords", 20);
  const noticeKinds = uniqueStrings(raw.noticeKinds, "noticeKinds", 4);
  if (!noticeKinds.every((kind) => kind in MENU_IDS)) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "sgcc-tender noticeKinds is invalid"
    );
  }
  const pageSize = raw.pageSize ?? 20;
  if (
    !Number.isInteger(pageSize) ||
    Number(pageSize) < 1 ||
    Number(pageSize) > 20
  ) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "sgcc-tender pageSize must be 1..20"
    );
  }
  return {
    keywords,
    noticeKinds: noticeKinds as NoticeKind[],
    pageSize: Number(pageSize)
  };
}

export function buildSgccTenderBody(
  noticeKind: NoticeKind,
  pageSize: number,
  keyword: string
) {
  return {
    index: 1,
    size: pageSize,
    firstPageMenuId: MENU_IDS[noticeKind],
    purOrgStatus: "",
    purOrgCode: "",
    purType: "",
    noticeType: "",
    orgId: "",
    key: keyword,
    orgName: ""
  };
}

export function mapSgccTenderResponse(
  payload: SgccResponse,
  noticeKind: NoticeKind
): StandardItem[] {
  const rows = payload.resultValue?.noteList;
  if (payload.successful !== true || !Array.isArray(rows)) {
    throw new SourceFetchError(
      "FETCH_PARSE",
      "sgcc-tender response is invalid"
    );
  }
  const seen = new Set<string>();
  const items: StandardItem[] = [];
  for (const raw of rows as SgccRow[]) {
    const docId = String(raw.firstPageDocId ?? "").trim();
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const org =
      typeof raw.publishOrgName === "string" ? raw.publishOrgName.trim() : "";
    const publishedAt =
      typeof raw.noticePublishTime === "string"
        ? parsePublishedAt(raw.noticePublishTime)
        : null;
    if (!docId || !title || !publishedAt || seen.has(docId)) continue;
    seen.add(docId);
    items.push({
      title,
      url: `${ITEM_URL}${encodeURIComponent(docId)}`,
      content: [LABELS[noticeKind], org, title].filter(Boolean).join(" · "),
      publishedAt
    });
  }
  return items;
}

export async function fetchSgccTender(
  config: AnnouncementSourceConfig,
  context: FetchContext,
  fetchImpl?: typeof fetch
) {
  const endpoint = resolveSgccTenderEndpoint(config);
  const { keywords, noticeKinds, pageSize } = validateSgccTenderConfig(config);
  const seen = new Set<string>();
  const items: StandardItem[] = [];

  for (const noticeKind of noticeKinds) {
    for (const keyword of keywords) {
      const body = buildSgccTenderBody(noticeKind, pageSize, keyword);
      const raw = await fetchTextWithPolicy(endpoint, {
        timeoutMs: 15_000,
        useRealUa: context.useRealUa,
        maxResponseBytes: 5 * 1024 * 1024,
        source: context.sourceName,
        fetchImpl,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        }
      });
      let payload: SgccResponse;
      try {
        payload = JSON.parse(raw) as SgccResponse;
      } catch {
        throw new SourceFetchError(
          "FETCH_PARSE",
          "sgcc-tender returned invalid JSON"
        );
      }
      for (const item of mapSgccTenderResponse(payload, noticeKind)) {
        const docId = item.url.slice(ITEM_URL.length);
        if (seen.has(docId)) continue;
        seen.add(docId);
        items.push(item);
      }
    }
  }

  if (items.length === 0) {
    throw new SourceFetchError(
      "FETCH_JSON_EMPTY",
      "sgcc-tender returned no valid items"
    );
  }
  return items;
}

export const sgccTenderAdapter: AnnouncementAdapter = {
  name: "sgcc-tender",
  fetch: (context) =>
    fetchSgccTender(
      (context.sourceConfig ?? {}) as AnnouncementSourceConfig,
      context
    )
};
