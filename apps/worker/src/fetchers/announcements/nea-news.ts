/**
 * 国家能源局能源要闻 JSON 数据源 adapter。
 *
 * 列表页由 Vue 在浏览器端加载同目录下的 ds_*.json；直接读取该公开数据源比
 * Playwright 更稳定，也避免为 6 小时一次的抓取长期占用 BrowserContext。
 */
import { SourceFetchError } from "@fe-radar/shared";
import type {
  AnnouncementSourceConfig,
  FetchContext,
  StandardItem
} from "../types";
import { fetchTextWithPolicy } from "../http";
import type { AnnouncementAdapter } from "./types";

const DEFAULT_ENDPOINT =
  "https://www.nea.gov.cn/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json";
const ALLOWED_HOST = "www.nea.gov.cn";
// The datasource filename carries a content hash that changes when the site republishes the
// column, so pinning the exact hash would break the source on an upstream refresh. Match the
// shape instead: same host, same /xwzx/ directory, same ds_<32-hex>.json convention.
// Keep in sync with apps/web/lib/api/sources-schema.ts announcementConfigValid (nea-news branch).
// apps/web and apps/worker must not import each other, so the allowlist rules are duplicated on purpose.
// Constraints (all must hold): protocol https:, hostname www.nea.gov.cn, path matches
// ALLOWED_PATH_PATTERN, port empty (default 443 only — non-default ports are a different origin),
// username/password empty (Node fetch throws on credentialed URLs and would be mis-wrapped as
// FETCH_TIMEOUT by the retry loop). query/hash are intentionally unrestricted: they do not change
// the request destination (host/port/path), are not an SSRF surface, and upstream may add
// cache-busting params later.
const ALLOWED_PATH_PATTERN = /^\/xwzx\/ds_[0-9a-f]{32}\.json$/;
const DEFAULT_PAGE_SIZE = 50;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

interface NeaNewsRecord {
  showTitle?: string;
  publishUrl?: string;
  publishTime?: string;
  contentType?: string;
}

interface NeaNewsResponse {
  datasource?: unknown[];
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveNeaNewsEndpoint(
  config: AnnouncementSourceConfig
): string {
  const endpoint =
    typeof config.endpoint === "string" && config.endpoint.trim()
      ? config.endpoint.trim()
      : DEFAULT_ENDPOINT;
  const parsed = new URL(endpoint);
  // Mirror of apps/web announcementConfigValid nea-news branch — keep byte-for-byte intent equal.
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== ALLOWED_HOST ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !ALLOWED_PATH_PATTERN.test(parsed.pathname)
  ) {
    throw new SourceFetchError(
      "FETCH_CONFIG",
      "nea-news endpoint is not allowlisted",
      { endpoint }
    );
  }
  return parsed.toString();
}

export function mapNeaNewsResponse(
  payload: NeaNewsResponse,
  endpoint = DEFAULT_ENDPOINT,
  pageSize = DEFAULT_PAGE_SIZE
): StandardItem[] {
  const rows = Array.isArray(payload.datasource) ? payload.datasource : [];
  const items: StandardItem[] = [];

  for (const row of rows) {
    if (items.length >= pageSize) break;
    if (!row || typeof row !== "object") continue;
    const record = row as NeaNewsRecord;
    if (record.contentType === "Link") continue;
    const title =
      typeof record.showTitle === "string" ? stripHtml(record.showTitle) : "";
    const href =
      typeof record.publishUrl === "string" ? record.publishUrl.trim() : "";
    const publishedAt =
      typeof record.publishTime === "string"
        ? new Date(record.publishTime.replace(" ", "T") + "+08:00")
        : new Date(NaN);
    if (!title || !href || Number.isNaN(publishedAt.getTime())) continue;
    let articleUrl: string;
    try {
      articleUrl = new URL(href, endpoint).toString();
    } catch {
      continue;
    }
    items.push({
      title,
      url: articleUrl,
      content: title,
      publishedAt
    });
  }

  return items;
}

export async function fetchNeaNews(
  config: AnnouncementSourceConfig,
  ctx: FetchContext,
  fetchImpl?: typeof fetch
): Promise<StandardItem[]> {
  const endpoint = resolveNeaNewsEndpoint(config);
  const raw = await fetchTextWithPolicy(endpoint, {
    timeoutMs: 15_000,
    useRealUa: ctx.useRealUa,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    source: ctx.sourceName,
    fetchImpl
  });

  let payload: NeaNewsResponse;
  try {
    payload = JSON.parse(raw) as NeaNewsResponse;
  } catch (error) {
    throw new SourceFetchError(
      "FETCH_PARSE",
      "nea-news returned invalid JSON",
      {
        endpoint,
        cause: error
      }
    );
  }

  const pageSize =
    typeof config.pageSize === "number"
      ? Math.min(Math.max(Math.floor(config.pageSize), 1), 200)
      : DEFAULT_PAGE_SIZE;
  const items = mapNeaNewsResponse(payload, endpoint, pageSize);
  if (items.length === 0) {
    throw new SourceFetchError(
      "FETCH_JSON_EMPTY",
      "nea-news returned no valid items",
      { endpoint }
    );
  }
  return items;
}

export const neaNewsAdapter: AnnouncementAdapter = {
  name: "nea-news",
  async fetch(ctx) {
    return fetchNeaNews(
      (ctx.sourceConfig ?? {}) as AnnouncementSourceConfig,
      ctx
    );
  }
};
