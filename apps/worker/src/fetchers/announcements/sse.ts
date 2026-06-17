/**
 * SSE 上交所上市公司公告 adapter
 *
 * Endpoint: GET http://query.sse.com.cn/security/stock/queryCompanyBulletin.do
 * JSONP 响应；优先官方 JSON API，不使用 Playwright。
 *
 * NFR: 禁止 LLM；抓取失败抛错交给 fetch handler 记录 source failure。
 */

import { SourceFetchError } from "@fe-radar/shared";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { proxyPool } from "../../lib/proxy-pool";
import { assertRobotsAllowed } from "../../lib/robots";
import { acquireUserAgent } from "../../lib/ua-pool";
import type { AnnouncementSourceConfig, FetchContext, StandardItem } from "../types";
import type { AnnouncementAdapter } from "./types";
import { isRateLimitFetchError } from "./rate-limit";

const DEFAULT_ENDPOINT = "http://query.sse.com.cn/security/stock/queryCompanyBulletin.do";
const SSE_BASE_URL = "https://www.sse.com.cn";
const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_BEGIN_PAGE = 0;
const DEFAULT_LOOKBACK_DAYS = 7;
const SSE_REFERER = "http://www.sse.com.cn/disclosure/bulletin/company/";
const ALLOWED_ENDPOINT_HOST = "query.sse.com.cn";
const ALLOWED_ENDPOINT_PATH = "/security/stock/queryCompanyBulletin.do";

export interface SseBulletinRecord {
  title?: string;
  url?: string;
  securityCode?: string;
  securityAbbrev?: string;
  sseDate?: string;
}

export interface SsePageHelp {
  data?: unknown[];
}

export interface SseApiResponse {
  success?: string | boolean;
  error?: string;
  pageHelp?: SsePageHelp;
}

interface FetchTextOptions {
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

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
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

function resolveDateRange(config: AnnouncementSourceConfig): [string, string] {
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

export function normalizeSseRecord(raw: Record<string, unknown>): SseBulletinRecord {
  return {
    title: pickString(raw, ["TITLE", "title"]),
    url: pickString(raw, ["URL", "url"]),
    securityCode: pickString(raw, ["SECURITY_CODE", "securityCode", "stock"]),
    securityAbbrev: pickString(raw, ["SECURITY_ABBREV", "SECURITY_NAME", "securityAbbrev", "securityName"]),
    sseDate: pickString(raw, ["SSEDate", "SSE_DATE", "sseDate", "publishDate"]),
  };
}

export function buildSseBulletinUrl(path: string): string {
  const trimmed = path.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `${SSE_BASE_URL}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

export function buildSseQueryUrl(config: AnnouncementSourceConfig, now = new Date()): string {
  const [beginDate, endDate] = resolveDateRange(config);
  const params = new URLSearchParams();
  params.set("jsonCallBack", "jsonpCallback");
  params.set("isPagination", "true");
  params.set("pageHelp.beginPage", String(typeof config.pageNum === "number" ? config.pageNum : DEFAULT_BEGIN_PAGE));
  params.set("pageHelp.pageSize", String(typeof config.pageSize === "number" ? config.pageSize : DEFAULT_PAGE_SIZE));
  params.set("beginDate", beginDate);
  params.set("endDate", endDate);
  params.set("_", String(now.getTime()));

  const stock =
    asStringArray(config.stock) ??
    asStringArray(config.stocks) ??
    asStringArray(config.stockCode) ??
    asStringArray(config.secCode) ??
    asStringArray(config.securityCode) ??
    (typeof config.securityCode === "string" && config.securityCode.trim()
      ? [config.securityCode.trim()]
      : undefined);

  if (stock?.[0]) {
    params.set("securityCode", stock[0]);
  }

  const companyName = typeof config.companyName === "string" ? config.companyName.trim() : "";
  if (companyName) {
    params.set("securityName", companyName);
  }

  const bulletinType = typeof config.bulletinType === "string" ? config.bulletinType.trim() : "";
  if (bulletinType) {
    params.set("productId", bulletinType);
  }

  return `${DEFAULT_ENDPOINT}?${params.toString()}`;
}

export function validateSseEndpoint(endpoint: string): string {
  const parsed = new URL(endpoint);
  if (parsed.hostname !== ALLOWED_ENDPOINT_HOST || parsed.pathname !== ALLOWED_ENDPOINT_PATH) {
    throw new SourceFetchError("FETCH_CONFIG", `SSE endpoint is not allowed: ${endpoint}`, { endpoint });
  }
  return endpoint;
}

export function parseSseJsonp(text: string): SseApiResponse | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const openParen = trimmed.indexOf("(");
  const closeParen = trimmed.lastIndexOf(")");
  const payload =
    openParen !== -1 && closeParen > openParen ? trimmed.slice(openParen + 1, closeParen) : trimmed;

  try {
    return JSON.parse(payload) as SseApiResponse;
  } catch {
    return null;
  }
}

export function parseSsePublishTime(value: string | undefined): Date | null {
  if (!value?.trim()) {
    return null;
  }

  const normalized = value.trim().replace(" ", "T");
  const withZone = normalized.endsWith("Z") ? normalized : `${normalized}+08:00`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveSseItemContent(record: SseBulletinRecord): string {
  return record.title?.trim() ?? "";
}

export function mapSseRecordToStandardItem(record: SseBulletinRecord): StandardItem | null {
  const title = record.title?.trim();
  const urlPath = record.url?.trim();
  const publishedAt = parseSsePublishTime(record.sseDate);

  if (!title || !urlPath || !publishedAt) {
    return null;
  }

  return {
    title,
    url: buildSseBulletinUrl(urlPath),
    content: resolveSseItemContent(record),
    publishedAt,
  };
}

export function mapSseResponseToStandardItems(response: SseApiResponse): StandardItem[] {
  const success = response.success;
  if (success === false || success === "false") {
    return [];
  }

  const rows = response.pageHelp?.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  return rows
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      return mapSseRecordToStandardItem(normalizeSseRecord(row as Record<string, unknown>));
    })
    .filter((item): item is StandardItem => item !== null);
}

async function fetchTextWithPolicy(url: string, options: FetchTextOptions): Promise<string | null> {
  const userAgent = acquireUserAgent(options.useRealUa);
  const fetchImpl = options.fetchImpl ?? undiciFetch;
  await assertRobotsAllowed(url, userAgent, fetchImpl as unknown as typeof fetch);

  let proxy = proxyPool.acquire();
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          "user-agent": userAgent,
          referer: SSE_REFERER,
        },
        signal: AbortSignal.timeout(options.timeoutMs),
        dispatcher: proxy?.server ? new ProxyAgent(proxy.server) : undefined,
      });

      if (response.status === 403 || response.status === 429) {
        proxyPool.release(proxy, false);
        proxy = proxyPool.acquire({ retry: true });
        lastError = new SourceFetchError(`FETCH_${response.status}`, `SSE request rejected with ${response.status}`, {
          url,
        });
        continue;
      }

      if (!response.ok) {
        throw new SourceFetchError("FETCH_HTTP_ERROR", `SSE request failed with ${response.status}`, { url });
      }

      proxyPool.release(proxy, true);
      return response.text();
    } catch (error) {
      proxyPool.release(proxy, false);
      proxy = proxyPool.acquire({ retry: true });
      lastError = error;
    }
  }

  if (lastError instanceof SourceFetchError) {
    if (isRateLimitFetchError(lastError)) {
      return null;
    }
    throw lastError;
  }
  throw new SourceFetchError("FETCH_TIMEOUT", "SSE request failed after retries", { url, cause: lastError });
}

export const sseAdapter: AnnouncementAdapter = {
  name: "sse",

  async fetch(ctx: FetchContext): Promise<StandardItem[]> {
    const config = (ctx.sourceConfig ?? {}) as AnnouncementSourceConfig;
    const endpoint =
      typeof config.endpoint === "string" && config.endpoint.trim()
        ? validateSseEndpoint(config.endpoint.trim())
        : buildSseQueryUrl(config);

    const body = await fetchTextWithPolicy(endpoint, {
      timeoutMs: 8000,
      useRealUa: ctx.useRealUa ?? true,
    });
    if (body === null) {
      return [];
    }
    const parsed = parseSseJsonp(body);
    if (!parsed) {
      throw new SourceFetchError("FETCH_PARSE_ERROR", "SSE JSONP response cannot be parsed", { endpoint });
    }
    return mapSseResponseToStandardItems(parsed);
  },
};
