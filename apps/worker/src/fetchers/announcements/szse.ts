/**
 * SZSE 深交所上市公司公告 adapter
 *
 * Endpoint: POST http://www.szse.cn/api/disc/announcement/annList
 * 优先 JSON API，不使用 Playwright。
 *
 * NFR: 禁止 LLM；抓取失败抛错交给 fetch handler 记录 source failure。
 */

import { waitHostGapForUrl } from "@fe-radar/core";
import { SourceFetchError } from "@fe-radar/shared";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { proxyPool } from "../../lib/proxy-pool";
import { assertRobotsAllowed } from "../../lib/robots";
import { acquireUserAgent } from "../../lib/ua-pool";
import type { AnnouncementSourceConfig, FetchContext, StandardItem } from "../types";
import type { AnnouncementAdapter } from "./types";
import { filterItemsByTitleKeywords, resolveTitleKeywords } from "./litigation-filter";
import { isRateLimitFetchError } from "./rate-limit";

const DEFAULT_ENDPOINT = "http://www.szse.cn/api/disc/announcement/annList";
const BASE_URL = "http://www.szse.cn";
const STATIC_BASE_URL = "http://disc.static.szse.cn";
const DEFAULT_CHANNEL_CODE = "listedNotice_disc";
const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_PAGE_NUM = 1;
const DEFAULT_LOOKBACK_DAYS = 7;
// Keep in sync with apps/web/lib/api/sources-schema.ts announcementConfigValid (szse branch).
// apps/web and apps/worker must not import each other, so the allowlist rules are duplicated on purpose.
// Constraints (all must hold): protocol http: or https: (NOT https-only — DEFAULT_ENDPOINT and seed
// configs are http://; forcing https would break the live T1 SZSE source), hostname www.szse.cn,
// path exact match, port empty (default 80/443 only — non-default ports are a different origin),
// username/password empty (Node/Undici fetch throws on credentialed URLs and would be mis-wrapped as
// FETCH_TIMEOUT by the retry loop). query/hash are intentionally unrestricted: they do not change
// the request destination (host/port/path) and are not an SSRF surface.
const ALLOWED_ENDPOINT_HOST = "www.szse.cn";
const ALLOWED_ENDPOINT_PATH = "/api/disc/announcement/annList";

export interface SzseAnnouncementRecord {
  id?: string;
  title?: string;
  content?: string | null;
  summary?: string | null;
  publishTime?: string;
  attachPath?: string;
  secCode?: string[];
  secName?: string[];
}

export interface SzseAnnouncementResponse {
  announceCount?: number;
  data?: SzseAnnouncementRecord[];
}

interface FetchJsonPostOptions {
  timeoutMs: number;
  useRealUa?: boolean;
  fetchImpl?: typeof undiciFetch;
}

function formatShanghaiDate(date: Date): string {
  const offsetMs = 8 * 60 * 60 * 1000;
  const local = new Date(date.getTime() + offsetMs);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function defaultDateRange(now = new Date()): [string, string] {
  const end = formatShanghaiDate(now);
  const startDate = new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return [formatShanghaiDate(startDate), end];
}

function asStringArray(value: unknown): string[] | undefined {
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  if (Array.isArray(value)) {
    const items = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

export function resolveSzseEndpoint(config: AnnouncementSourceConfig): string {
  const endpoint = typeof config.endpoint === "string" && config.endpoint.trim() ? config.endpoint.trim() : DEFAULT_ENDPOINT;
  const parsed = new URL(endpoint);
  // Mirror of apps/web announcementConfigValid szse branch — keep byte-for-byte intent equal.
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.hostname !== ALLOWED_ENDPOINT_HOST ||
    parsed.pathname !== ALLOWED_ENDPOINT_PATH ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new SourceFetchError("FETCH_CONFIG", `SZSE endpoint is not allowed: ${endpoint}`, { endpoint });
  }
  return endpoint;
}

function resolveDateRange(config: AnnouncementSourceConfig): [string, string] {
  const explicitRange = config.seDate;
  if (Array.isArray(explicitRange) && explicitRange.length === 2) {
    const start = String(explicitRange[0] ?? "").trim();
    const end = String(explicitRange[1] ?? "").trim();
    if (start && end) {
      return [start, end];
    }
  }

  const beginDate = typeof config.beginDate === "string" ? config.beginDate.trim() : "";
  const endDate = typeof config.endDate === "string" ? config.endDate.trim() : "";
  if (beginDate && endDate) {
    return [beginDate, endDate];
  }
  if (beginDate) {
    return [beginDate, beginDate];
  }

  return defaultDateRange();
}

export function buildSzseRequestBody(config: AnnouncementSourceConfig): Record<string, unknown> {
  const seDate = resolveDateRange(config);
  const stock =
    asStringArray(config.stock) ??
    asStringArray(config.stocks) ??
    asStringArray(config.stockCode) ??
    asStringArray(config.secCode);

  const body: Record<string, unknown> = {
    seDate,
    channelCode: asStringArray(config.channelCode) ?? [DEFAULT_CHANNEL_CODE],
    pageSize: typeof config.pageSize === "number" ? config.pageSize : DEFAULT_PAGE_SIZE,
    pageNum: typeof config.pageNum === "number" ? config.pageNum : DEFAULT_PAGE_NUM,
  };

  if (stock) {
    body.stock = stock;
  }

  const bigCategoryId = asStringArray(config.bigCategoryId);
  if (bigCategoryId) {
    body.bigCategoryId = bigCategoryId;
  }

  return body;
}

export function parseSzsePublishTime(value: string | undefined): Date | null {
  if (!value?.trim()) {
    return null;
  }

  const normalized = value.trim().replace(" ", "T");
  const withZone = normalized.endsWith("Z") ? normalized : `${normalized}+08:00`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildSzseDetailUrl(id: string): string {
  return `${BASE_URL}/disclosure/listed/bulletinDetail/index.html?${id}`;
}

export function buildSzseAttachmentUrl(attachPath: string): string {
  const normalized = attachPath.startsWith("/") ? attachPath : `/${attachPath}`;
  return `${STATIC_BASE_URL}/download${normalized}`;
}

export function resolveSzseItemUrl(record: SzseAnnouncementRecord): string | null {
  if (record.id?.trim()) {
    return buildSzseDetailUrl(record.id.trim());
  }
  if (record.attachPath?.trim()) {
    return buildSzseAttachmentUrl(record.attachPath.trim());
  }
  return null;
}

export function resolveSzseItemContent(record: SzseAnnouncementRecord): string {
  const summary = record.summary?.trim();
  if (summary) {
    return summary;
  }
  const content = record.content?.trim();
  if (content) {
    return content;
  }
  return record.title?.trim() ?? "";
}

export function mapSzseRecordToStandardItem(record: SzseAnnouncementRecord): StandardItem | null {
  const title = record.title?.trim();
  const url = resolveSzseItemUrl(record);
  const publishedAt = parseSzsePublishTime(record.publishTime);

  if (!title || !url || !publishedAt) {
    return null;
  }

  return {
    title,
    url,
    content: resolveSzseItemContent(record),
    publishedAt,
  };
}

export function mapSzseResponseToStandardItems(response: SzseAnnouncementResponse): StandardItem[] {
  if (!Array.isArray(response.data) || response.data.length === 0) {
    return [];
  }

  return response.data
    .map((record) => mapSzseRecordToStandardItem(record))
    .filter((item): item is StandardItem => item !== null);
}

export async function fetchJsonPostWithPolicy(
  url: string,
  body: Record<string, unknown>,
  options: FetchJsonPostOptions
): Promise<SzseAnnouncementResponse> {
  const userAgent = acquireUserAgent(options.useRealUa);
  const fetchImpl = options.fetchImpl ?? undiciFetch;
  await assertRobotsAllowed(url, userAgent, fetchImpl as unknown as typeof fetch);

  let proxy = proxyPool.acquire();
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      // T-CA-04 / design §3.4.2 IN④：每次 POST 前打同站闸（含 retry 第二发）。
      await waitHostGapForUrl(url);
      const response = await fetchImpl(`${url}?random=${Math.random()}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": userAgent,
          referer: `${BASE_URL}/disclosure/listed/notice/index.html`,
          origin: BASE_URL,
          "x-requested-with": "XMLHttpRequest",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs),
        dispatcher: proxy?.server ? new ProxyAgent(proxy.server) : undefined,
      });

      if (response.status === 403 || response.status === 429) {
        proxyPool.release(proxy, false);
        proxy = proxyPool.acquire({ retry: true });
        lastError = new SourceFetchError(`FETCH_${response.status}`, `SZSE request rejected with ${response.status}`, {
          url,
        });
        continue;
      }

      if (!response.ok) {
        throw new SourceFetchError("FETCH_HTTP_ERROR", `SZSE request failed with ${response.status}`, { url });
      }

      proxyPool.release(proxy, true);
      return (await response.json()) as SzseAnnouncementResponse;
    } catch (error) {
      proxyPool.release(proxy, false);
      proxy = proxyPool.acquire({ retry: true });
      lastError = error;
    }
  }

  if (lastError instanceof SourceFetchError) {
    if (isRateLimitFetchError(lastError)) {
      return {};
    }
    throw lastError;
  }
  throw new SourceFetchError("FETCH_TIMEOUT", "SZSE request failed after retries", { url, cause: lastError });
}

export const szseAdapter: AnnouncementAdapter = {
  name: "szse",

  async fetch(ctx: FetchContext): Promise<StandardItem[]> {
    const config = (ctx.sourceConfig ?? {}) as AnnouncementSourceConfig;
    const endpoint = resolveSzseEndpoint(config);

    const response = await fetchJsonPostWithPolicy(endpoint, buildSzseRequestBody(config), {
      timeoutMs: 8000,
      useRealUa: ctx.useRealUa ?? true,
    });
    const items = mapSzseResponseToStandardItems(response);
    return filterItemsByTitleKeywords(items, resolveTitleKeywords(config));
  },
};
