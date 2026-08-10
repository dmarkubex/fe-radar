/**
 * SSE 上交所上市公司公告 adapter
 *
 * Endpoint: GET http://query.sse.com.cn/security/stock/queryCompanyBulletin.do
 * JSONP 响应；优先官方 JSON API，不使用 Playwright。
 *
 * NFR: 禁止 LLM；抓取失败抛错交给 fetch handler 记录 source failure。
 */

import { SourceFetchError } from "@fe-radar/shared";
import { fetchTextWithPolicy } from "../http";
import type { AnnouncementSourceConfig, FetchContext, StandardItem } from "../types";
import type { AnnouncementAdapter } from "./types";
import { isRateLimitFetchError } from "./rate-limit";

const DEFAULT_ENDPOINT = "http://query.sse.com.cn/security/stock/queryCompanyBulletin.do";
const SSE_BASE_URL = "https://www.sse.com.cn";
const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_BEGIN_PAGE = 0;
const DEFAULT_LOOKBACK_DAYS = 7;
const SSE_REFERER = "http://www.sse.com.cn/disclosure/bulletin/company/";
// T-SEC-07: JSONP 响应在解析前必须有字节上限（共享 fetchTextWithPolicy 强制执行）。
// 默认 2MB（pageSize≤30 的公告列表正常远小于 1MB），可经 SSE_MAX_RESPONSE_BYTES 覆盖。
const SSE_MAX_RESPONSE_BYTES = (() => {
  const v = Number(process.env.SSE_MAX_RESPONSE_BYTES ?? 2 * 1024 * 1024);
  return Number.isFinite(v) && v > 0 ? v : 2 * 1024 * 1024;
})();
// Keep in sync with apps/web/lib/api/sources-schema.ts announcementConfigValid (sse branch).
// apps/web and apps/worker must not import each other, so the allowlist rules are duplicated on purpose.
// Constraints (all must hold): protocol http: or https: (NOT https-only — DEFAULT_ENDPOINT and seed
// configs are http://; forcing https would break the live T1 SSE source), hostname query.sse.com.cn,
// path exact match, port empty (default 80/443 only — non-default ports are a different origin),
// username/password empty (Node/Undici fetch throws on credentialed URLs and would be mis-wrapped as
// FETCH_TIMEOUT by the retry loop). query/hash are intentionally unrestricted: they do not change
// the request destination (host/port/path) and are not an SSRF surface.
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
  // Mirror of apps/web announcementConfigValid sse branch — keep byte-for-byte intent equal.
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.hostname !== ALLOWED_ENDPOINT_HOST ||
    parsed.pathname !== ALLOWED_ENDPOINT_PATH ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
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

export const sseAdapter: AnnouncementAdapter = {
  name: "sse",

  async fetch(ctx: FetchContext): Promise<StandardItem[]> {
    const config = (ctx.sourceConfig ?? {}) as AnnouncementSourceConfig;
    const endpoint =
      typeof config.endpoint === "string" && config.endpoint.trim()
        ? validateSseEndpoint(config.endpoint.trim())
        : buildSseQueryUrl(config);

    // T-SEC-12: 走共享 fetchTextWithPolicy（fetchers/http.ts）——SSRF 守卫 + redirect manual
    // 逐跳复验 + 字节上限 + UA 轮换 / robots / 代理池，不再保留本地简化实现。
    // 403/429 耗尽策略层重试后降级为空结果，避免 BullMQ job 级重试风暴（isRateLimitFetchError）。
    let body: string;
    try {
      body = await fetchTextWithPolicy(endpoint, {
        timeoutMs: 8000,
        useRealUa: ctx.useRealUa ?? true,
        maxResponseBytes: SSE_MAX_RESPONSE_BYTES,
        init: { headers: { referer: SSE_REFERER } },
      });
    } catch (error) {
      if (isRateLimitFetchError(error)) {
        return [];
      }
      throw error;
    }

    const parsed = parseSseJsonp(body);
    if (!parsed) {
      throw new SourceFetchError("FETCH_PARSE_ERROR", "SSE JSONP response cannot be parsed", { endpoint });
    }
    return mapSseResponseToStandardItems(parsed);
  },
};
