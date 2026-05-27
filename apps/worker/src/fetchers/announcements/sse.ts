/**
 * SSE 上交所上市公司公告 adapter
 *
 * Endpoint: http://query.sse.com.cn/security/stock/queryCompanyBulletin.do
 * GET JSON API，不使用 Playwright。
 *
 * NFR: 禁止 LLM；失败返回 []。
 */

import { SourceFetchError } from "@fe-radar/shared";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { proxyPool } from "../../lib/proxy-pool";
import { assertRobotsAllowed } from "../../lib/robots";
import { acquireUserAgent } from "../../lib/ua-pool";
import type { AnnouncementSourceConfig, FetchContext, StandardItem } from "../types";
import type { AnnouncementAdapter } from "./types";

const DEFAULT_ENDPOINT = "http://query.sse.com.cn/security/stock/queryCompanyBulletin.do";
const BASE_URL = "http://www.sse.com.cn";
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_PAGE_BEGIN = 0;
const DEFAULT_LOOKBACK_DAYS = 7;

export interface SseBulletinRecord {
  bulletinId?: string;
  title?: string;
  securityCode?: string;
  securityAbbrev?: string;
  adjunctUrl?: string;
  adjunctType?: string;
  adjunctSize?: number;
  bulletinType?: string;
  sseDate?: string;
}

export interface SsePageHelp {
  total?: number;
  page?: number;
  data?: SseBulletinRecord[];
}

export interface SseBulletinResponse {
  pageHelp?: SsePageHelp;
}

interface FetchJsonGetOptions {
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

export function resolveSseDateRange(config: AnnouncementSourceConfig): [string, string] {
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

export function buildSseQueryParams(config: AnnouncementSourceConfig): Record<string, string> {
  const [beginDate, endDate] = resolveSseDateRange(config);
  const params: Record<string, string> = {
    isPagination: "true",
    "pageHelp.beginPage": String(typeof config.pageBegin === "number" ? config.pageBegin : DEFAULT_PAGE_BEGIN),
    "pageHelp.pageSize": String(typeof config.pageSize === "number" ? config.pageSize : DEFAULT_PAGE_SIZE),
    beginDate,
    endDate,
    _: String(Date.now()),
  };

  const securityCode = typeof config.securityCode === "string" ? config.securityCode.trim() : "";
  if (securityCode) {
    params.securityCode = securityCode;
  }

  const bulletinType = typeof config.bulletinType === "string" ? config.bulletinType.trim() : "";
  if (bulletinType) {
    params.bulletinType = bulletinType;
  }

  return params;
}

export function buildSseQueryString(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export function parseSseDate(value: string | undefined): Date | null {
  if (!value?.trim()) {
    return null;
  }
  const parsed = new Date(`${value.trim()}T00:00:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildSseDetailUrl(adjunctUrl: string): string {
  const normalized = adjunctUrl.startsWith("/") ? adjunctUrl : `/${adjunctUrl}`;
  return `${BASE_URL}${normalized}`;
}

export function resolveSseItemUrl(record: SseBulletinRecord): string | null {
  if (record.adjunctUrl?.trim()) {
    return buildSseDetailUrl(record.adjunctUrl.trim());
  }
  if (record.bulletinId?.trim()) {
    return `${BASE_URL}/disclosure/bulletin/detail/bulletinId/${record.bulletinId.trim()}/`;
  }
  return null;
}

export function resolveSseItemContent(record: SseBulletinRecord): string {
  const title = record.title?.trim() ?? "";
  const code = record.securityCode?.trim();
  const abbrev = record.securityAbbrev?.trim();
  if (title && code && abbrev) {
    return title;
  }
  return title || code || "";
}

export function mapSseRecordToStandardItem(record: SseBulletinRecord): StandardItem | null {
  const title = record.title?.trim();
  const url = resolveSseItemUrl(record);
  const publishedAt = parseSseDate(record.sseDate);

  if (!title || !url || !publishedAt) {
    return null;
  }

  return {
    title,
    url,
    content: resolveSseItemContent(record),
    publishedAt,
  };
}

export function mapSseResponseToStandardItems(response: SseBulletinResponse): StandardItem[] {
  const data = response.pageHelp?.data;
  if (!Array.isArray(data) || data.length === 0) {
    return [];
  }
  return data
    .map((record) => mapSseRecordToStandardItem(record))
    .filter((item): item is StandardItem => item !== null);
}

export async function fetchJsonGetWithPolicy(
  url: string,
  params: Record<string, string>,
  options: FetchJsonGetOptions
): Promise<SseBulletinResponse> {
  const userAgent = acquireUserAgent(options.useRealUa);
  const fetchImpl = options.fetchImpl ?? undiciFetch;
  await assertRobotsAllowed(url, userAgent, fetchImpl as unknown as typeof fetch);

  const qs = buildSseQueryString(params);
  const fullUrl = `${url}?${qs}`;

  let proxy = proxyPool.acquire();
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(fullUrl, {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": userAgent,
          referer: `${BASE_URL}/disclosure/bulletin/company/`,
        },
        signal: AbortSignal.timeout(options.timeoutMs),
        dispatcher: proxy?.server ? new ProxyAgent(proxy.server) : undefined,
      });

      if (response.status === 403 || response.status === 429) {
        proxyPool.release(proxy, false);
        proxy = proxyPool.acquire({ retry: true });
        lastError = new SourceFetchError(
          `FETCH_${response.status}`,
          `SSE request rejected with ${response.status}`,
          { url: fullUrl }
        );
        continue;
      }

      if (!response.ok) {
        throw new SourceFetchError("FETCH_HTTP_ERROR", `SSE request failed with ${response.status}`, {
          url: fullUrl,
        });
      }

      proxyPool.release(proxy, true);
      return (await response.json()) as SseBulletinResponse;
    } catch (error) {
      proxyPool.release(proxy, false);
      proxy = proxyPool.acquire({ retry: true });
      lastError = error;
    }
  }

  if (lastError instanceof SourceFetchError) {
    throw lastError;
  }
  throw new SourceFetchError("FETCH_TIMEOUT", "SSE request failed after retries", {
    url: fullUrl,
    cause: lastError,
  });
}

export const sseAdapter: AnnouncementAdapter = {
  name: "sse",

  async fetch(ctx: FetchContext): Promise<StandardItem[]> {
    const config = (ctx.sourceConfig ?? {}) as AnnouncementSourceConfig;
    const endpoint =
      (typeof config.endpoint === "string" && config.endpoint.trim()) || DEFAULT_ENDPOINT;

    try {
      const response = await fetchJsonGetWithPolicy(endpoint, buildSseQueryParams(config), {
        timeoutMs: 8000,
        useRealUa: ctx.useRealUa ?? true,
      });
      return mapSseResponseToStandardItems(response);
    } catch {
      return [];
    }
  },
};
