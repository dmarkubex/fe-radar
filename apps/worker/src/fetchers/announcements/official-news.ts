import { SourceFetchError } from "@fe-radar/shared";
import { load } from "cheerio";
import { parsePublishedAt } from "../html";
import { fetchTextWithPolicy } from "../http";
import type {
  AnnouncementSourceConfig,
  FetchContext,
  StandardItem
} from "../types";
import type { AnnouncementAdapter } from "./types";

const NEXANS_ENDPOINT =
  "https://www.nexans.com/ajax.php?action=last_posts&cpt_slug=documents&wpml_lang=en&page=1&tag_to_display=document_types";
const HUAWEI_ENDPOINT =
  "https://digitalpower.huawei.com/service/portalapplication/v1/digitalpower/news";
const HUAWEI_CONTENT_ID = "48e0a5ce972c4e4aa847fd0e1b127b19";
const STORAGE_TERMS = /\b(?:BESS|ESS)\b|energy storage|storage system/i;

interface NexansRecord {
  title?: string;
  post_date?: string;
  post_link?: string;
  tag_to_display?: string[];
  fields?: { description?: string };
}

interface NexansResponse {
  success?: boolean;
  data?: { list?: NexansRecord[] };
}

interface HuaweiRecord {
  title?: string;
  description?: string;
  releaseFormatTime?: string;
  pageUrl?: string;
}

interface HuaweiResponse {
  code?: number;
  data?: { results?: HuaweiRecord[] };
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return load(value, null, false).root().text().replace(/\s+/g, " ").trim();
}

function validOfficialUrl(value: unknown, hostname: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(
      value.startsWith("http") ? value : `https://${value.replace(/^\/+/, "")}`
    );
    return url.protocol === "https:" && url.hostname === hostname
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function endpointFromConfig(
  config: AnnouncementSourceConfig,
  fallback: string
): URL {
  return new URL(
    typeof config.endpoint === "string" && config.endpoint.trim()
      ? config.endpoint.trim()
      : fallback
  );
}

export function resolveNexansEndpoint(
  config: AnnouncementSourceConfig
): string {
  const endpoint = endpointFromConfig(config, NEXANS_ENDPOINT);
  const expected = new URL(NEXANS_ENDPOINT);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== expected.hostname ||
    endpoint.port !== "" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.pathname !== expected.pathname ||
    endpoint.hash !== "" ||
    endpoint.searchParams.toString() !== expected.searchParams.toString()
  ) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "nexans-news endpoint is not allowlisted",
      { endpoint: endpoint.toString() }
    );
  }
  return endpoint.toString();
}

export function resolveHuaweiEndpoint(
  config: AnnouncementSourceConfig
): string {
  const endpoint = endpointFromConfig(config, HUAWEI_ENDPOINT);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== "digitalpower.huawei.com" ||
    endpoint.port !== "" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.pathname !== "/service/portalapplication/v1/digitalpower/news" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "huawei-digital-power-news endpoint is not allowlisted",
      { endpoint: endpoint.toString() }
    );
  }
  return endpoint.toString();
}

export function mapNexansResponse(
  payload: NexansResponse,
  pageSize = 50
): StandardItem[] {
  const rows = payload.success ? payload.data?.list : undefined;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, pageSize).flatMap((row) => {
    const title = normalizeText(row.title);
    const description = normalizeText(row.fields?.description);
    const publishedAt = parsePublishedAt(row.post_date);
    const url = validOfficialUrl(row.post_link, "www.nexans.com");
    if (!title || !publishedAt || !url) return [];
    return [
      {
        title,
        url,
        content: [title, description, ...(row.tag_to_display ?? [])]
          .filter(Boolean)
          .join(" "),
        publishedAt
      }
    ];
  });
}

export function mapHuaweiResponse(
  payload: HuaweiResponse,
  pageSize = 50
): StandardItem[] {
  const rows = payload.code === 200 ? payload.data?.results : undefined;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, pageSize).flatMap((row) => {
    const title = normalizeText(row.title);
    const description = normalizeText(row.description);
    const content = `${title} ${description}`.trim();
    const publishedAt = parsePublishedAt(row.releaseFormatTime);
    const url = validOfficialUrl(row.pageUrl, "digitalpower.huawei.com");
    if (!title || !publishedAt || !url || !STORAGE_TERMS.test(content)) {
      return [];
    }
    return [{ title, url, content, publishedAt }];
  });
}

function parseJson<T>(raw: string, adapter: string, endpoint: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new SourceFetchError(
      "FETCH_PARSE",
      `${adapter} returned invalid JSON`,
      { endpoint, cause }
    );
  }
}

function configuredPageSize(config: AnnouncementSourceConfig): number {
  return typeof config.pageSize === "number"
    ? Math.min(Math.max(Math.floor(config.pageSize), 1), 100)
    : 50;
}

export async function fetchNexansNews(
  config: AnnouncementSourceConfig,
  ctx: FetchContext,
  fetchImpl?: typeof fetch
): Promise<StandardItem[]> {
  const endpoint = resolveNexansEndpoint(config);
  const raw = await fetchTextWithPolicy(endpoint, {
    timeoutMs: 15_000,
    useRealUa: ctx.useRealUa,
    maxResponseBytes: 2 * 1024 * 1024,
    source: ctx.sourceName,
    fetchImpl
  });
  const items = mapNexansResponse(
    parseJson<NexansResponse>(raw, "nexans-news", endpoint),
    configuredPageSize(config)
  );
  if (items.length === 0) {
    throw new SourceFetchError(
      "FETCH_JSON_EMPTY",
      "nexans-news returned no valid items",
      { endpoint }
    );
  }
  return items;
}

export async function fetchHuaweiDigitalPowerNews(
  config: AnnouncementSourceConfig,
  ctx: FetchContext,
  fetchImpl?: typeof fetch
): Promise<StandardItem[]> {
  const endpoint = resolveHuaweiEndpoint(config);
  const contentId =
    typeof config.contentId === "string" ? config.contentId : HUAWEI_CONTENT_ID;
  if (!/^[0-9a-f]{32}$/.test(contentId)) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "huawei-digital-power-news contentId is invalid"
    );
  }
  const pageSize = configuredPageSize(config);
  const raw = await fetchTextWithPolicy(endpoint, {
    timeoutMs: 15_000,
    useRealUa: ctx.useRealUa,
    maxResponseBytes: 5 * 1024 * 1024,
    source: ctx.sourceName,
    fetchImpl,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentId,
        filterLabelList: [],
        keyword:
          typeof config.searchkey === "string" ? config.searchkey : "ESS",
        pageNum: 1,
        pageSize,
        returnSelf: false,
        queryMode: "ALL"
      })
    }
  });
  const items = mapHuaweiResponse(
    parseJson<HuaweiResponse>(raw, "huawei-digital-power-news", endpoint),
    pageSize
  );
  if (items.length === 0) {
    throw new SourceFetchError(
      "FETCH_JSON_EMPTY",
      "huawei-digital-power-news returned no valid storage items",
      { endpoint }
    );
  }
  return items;
}

export const nexansNewsAdapter: AnnouncementAdapter = {
  name: "nexans-news",
  fetch(ctx) {
    return fetchNexansNews(
      (ctx.sourceConfig ?? {}) as AnnouncementSourceConfig,
      ctx
    );
  }
};

export const huaweiDigitalPowerNewsAdapter: AnnouncementAdapter = {
  name: "huawei-digital-power-news",
  fetch(ctx) {
    return fetchHuaweiDigitalPowerNews(
      (ctx.sourceConfig ?? {}) as AnnouncementSourceConfig,
      ctx
    );
  }
};
