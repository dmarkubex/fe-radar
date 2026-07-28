/**
 * CNINFO 巨潮资讯上市公司公告 adapter
 *
 * Endpoint: POST http://www.cninfo.com.cn/new/hisAnnouncement/query
 * POST form-urlencoded API，不使用 Playwright。
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
import { dedupeStandardItems, filterItemsByTitleKeywords, resolveTitleKeywords } from "./litigation-filter";
import { isRateLimitFetchError } from "./rate-limit";

const DEFAULT_ENDPOINT = "http://www.cninfo.com.cn/new/hisAnnouncement/query";
const BASE_URL = "http://www.cninfo.com.cn";
const STATIC_BASE_URL = "http://static.cninfo.com.cn";
const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_PAGE_NUM = 1;
const DEFAULT_LOOKBACK_DAYS = 7;
// Keep in sync with apps/web/lib/api/sources-schema.ts announcementConfigValid (cninfo branch).
// apps/web and apps/worker must not import each other, so the allowlist rules are duplicated on purpose.
// Constraints (all must hold): protocol http: or https: (NOT https-only — DEFAULT_ENDPOINT and seed
// configs are http://; forcing https would break the live T1 CNINFO source), hostname www.cninfo.com.cn,
// path exact match, port empty (default 80/443 only — non-default ports are a different origin),
// username/password empty (Node/Undici fetch throws on credentialed URLs and would be mis-wrapped as
// FETCH_TIMEOUT by the retry loop). query/hash are intentionally unrestricted: they do not change
// the request destination (host/port/path) and are not an SSRF surface.
const ALLOWED_ENDPOINT_HOST = "www.cninfo.com.cn";
const ALLOWED_ENDPOINT_PATH = "/new/hisAnnouncement/query";

export interface CninfoAnnouncementRecord {
  id?: string;
  secCode?: string;
  secName?: string;
  announcementId?: string;
  announcementTitle?: string;
  announcementTypeName?: string;
  adjunctUrl?: string;
  adjunctSize?: number;
  adjunctType?: string;
  announcementTime?: number;
  columnId?: string;
  pageRow?: number;
  tileLink?: string | null;
}

export interface CninfoAnnouncementResponse {
  announcements?: CninfoAnnouncementRecord[];
  totalAnnouncement?: number;
  totalRecordNum?: number;
  hasMore?: boolean;
}

interface FetchFormPostOptions {
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

function resolveLookbackDays(config: AnnouncementSourceConfig): number {
  if (typeof config.lookbackDays === "number" && Number.isFinite(config.lookbackDays) && config.lookbackDays > 0) {
    return Math.floor(config.lookbackDays);
  }
  return DEFAULT_LOOKBACK_DAYS;
}

function defaultDateRangeForLookback(lookbackDays: number, now = new Date()): string {
  const end = formatShanghaiDate(now);
  const startDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const start = formatShanghaiDate(startDate);
  return `${start}~${end}`;
}

export function resolveCninfoDateRange(config: AnnouncementSourceConfig): string {
  if (typeof config.seDate === "string" && config.seDate.trim()) {
    return config.seDate.trim();
  }

  const beginDate = typeof config.beginDate === "string" ? config.beginDate.trim() : "";
  const endDate = typeof config.endDate === "string" ? config.endDate.trim() : "";
  if (beginDate && endDate) {
    return `${beginDate}~${endDate}`;
  }
  if (beginDate) {
    return `${beginDate}~${beginDate}`;
  }

  return defaultDateRangeForLookback(resolveLookbackDays(config));
}

export function buildCninfoFormParams(config: AnnouncementSourceConfig): Record<string, string> {
  const params: Record<string, string> = {
    pageNum: String(typeof config.pageNum === "number" ? config.pageNum : DEFAULT_PAGE_NUM),
    pageSize: String(typeof config.pageSize === "number" ? config.pageSize : DEFAULT_PAGE_SIZE),
    seDate: resolveCninfoDateRange(config),
  };

  const column = typeof config.column === "string" ? config.column.trim() : "";
  if (column) {
    params.column = column;
  }

  const tabName = typeof config.tabName === "string" ? config.tabName.trim() : "";
  if (tabName) {
    params.tabName = tabName;
  }

  const stock = typeof config.stock === "string" ? config.stock.trim() : "";
  if (stock) {
    params.stock = stock;
  }

  const searchkey = typeof config.searchkey === "string" ? config.searchkey.trim() : "";
  if (searchkey) {
    params.searchkey = searchkey;
  }

  const category = typeof config.category === "string" ? config.category.trim() : "";
  if (category) {
    params.category = category;
  }

  const plate = typeof config.plate === "string" ? config.plate.trim() : "";
  if (plate) {
    params.plate = plate;
  }

  const trade = typeof config.trade === "string" ? config.trade.trim() : "";
  if (trade) {
    params.trade = trade;
  }

  return params;
}

export function buildCninfoFormBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export function resolveCninfoEndpoint(config: AnnouncementSourceConfig): string {
  const endpoint = typeof config.endpoint === "string" && config.endpoint.trim() ? config.endpoint.trim() : DEFAULT_ENDPOINT;
  const parsed = new URL(endpoint);
  // Mirror of apps/web announcementConfigValid cninfo branch — keep byte-for-byte intent equal.
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.hostname !== ALLOWED_ENDPOINT_HOST ||
    parsed.pathname !== ALLOWED_ENDPOINT_PATH ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new SourceFetchError("FETCH_CONFIG", `CNINFO endpoint is not allowed: ${endpoint}`, { endpoint });
  }
  return endpoint;
}

export function parseCninfoTimestamp(value: number | undefined): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const ts = value > 1e12 ? value : value * 1000;
  const parsed = new Date(ts);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildCninfoDetailUrl(announcementId: string | undefined, adjunctUrl?: string): string | null {
  if (adjunctUrl?.trim()) {
    const normalized = adjunctUrl.trim();
    if (normalized.startsWith("http")) {
      return normalized;
    }
    const prefix = normalized.startsWith("/") ? "" : "/";
    return `${STATIC_BASE_URL}${prefix}${normalized}`;
  }
  if (announcementId?.trim()) {
    return `${BASE_URL}/new/disclosure/detail?announcementId=${encodeURIComponent(announcementId.trim())}&orgId=&announcementTime=`;
  }
  return null;
}

export function resolveCninfoItemContent(record: CninfoAnnouncementRecord): string {
  return record.announcementTitle?.trim() ?? record.secName?.trim() ?? "";
}

export function mapCninfoRecordToStandardItem(record: CninfoAnnouncementRecord): StandardItem | null {
  const announcementTitle = record.announcementTitle?.trim();
  const url = buildCninfoDetailUrl(
    typeof record.announcementId === "string" ? record.announcementId : undefined,
    record.adjunctUrl
  );
  const publishedAt = parseCninfoTimestamp(record.announcementTime);

  if (!announcementTitle || !url || !publishedAt) {
    return null;
  }

  const secName = record.secName?.trim();
  const title = secName ? `${secName} ${announcementTitle}` : announcementTitle;

  return {
    title,
    url,
    content: resolveCninfoItemContent(record),
    publishedAt,
  };
}

export function mapCninfoResponseToStandardItems(response: CninfoAnnouncementResponse): StandardItem[] {
  if (!Array.isArray(response.announcements) || response.announcements.length === 0) {
    return [];
  }
  return response.announcements
    .map((record) => mapCninfoRecordToStandardItem(record))
    .filter((item): item is StandardItem => item !== null);
}

export async function fetchFormPostWithPolicy(
  url: string,
  params: Record<string, string>,
  options: FetchFormPostOptions
): Promise<CninfoAnnouncementResponse> {
  const userAgent = acquireUserAgent(options.useRealUa);
  const fetchImpl = options.fetchImpl ?? undiciFetch;
  await assertRobotsAllowed(url, userAgent, fetchImpl as unknown as typeof fetch);

  const body = buildCninfoFormBody(params);
  let proxy = proxyPool.acquire();
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          accept: "application/json, text/javascript, */*; q=0.01",
          "user-agent": userAgent,
          referer: `${BASE_URL}/new/disclosure`,
          origin: BASE_URL,
          "x-requested-with": "XMLHttpRequest",
        },
        body,
        signal: AbortSignal.timeout(options.timeoutMs),
        dispatcher: proxy?.server ? new ProxyAgent(proxy.server) : undefined,
      });

      if (response.status === 403 || response.status === 429) {
        proxyPool.release(proxy, false);
        proxy = proxyPool.acquire({ retry: true });
        lastError = new SourceFetchError(
          `FETCH_${response.status}`,
          `CNINFO request rejected with ${response.status}`,
          { url }
        );
        continue;
      }

      if (!response.ok) {
        throw new SourceFetchError(
          "FETCH_HTTP_ERROR",
          `CNINFO request failed with ${response.status}`,
          { url }
        );
      }

      proxyPool.release(proxy, true);
      return (await response.json()) as CninfoAnnouncementResponse;
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
  throw new SourceFetchError("FETCH_TIMEOUT", "CNINFO request failed after retries", {
    url,
    cause: lastError,
  });
}

export function resolveCninfoStockCodes(config: AnnouncementSourceConfig): string[] {
  const stocks = config.stocks;
  if (Array.isArray(stocks)) {
    return stocks
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim());
  }

  const stock = typeof config.stock === "string" ? config.stock.trim() : "";
  return stock ? [stock] : [];
}

export const cninfoAdapter: AnnouncementAdapter = {
  name: "cninfo",

  async fetch(ctx: FetchContext): Promise<StandardItem[]> {
    const config = (ctx.sourceConfig ?? {}) as AnnouncementSourceConfig;
    const endpoint = resolveCninfoEndpoint(config);
    const stockCodes = resolveCninfoStockCodes(config);
    const titleKeywords = resolveTitleKeywords(config);

    if (stockCodes.length === 0) {
      const response = await fetchFormPostWithPolicy(endpoint, buildCninfoFormParams(config), {
        timeoutMs: 8000,
        useRealUa: ctx.useRealUa ?? true,
      });
      return filterItemsByTitleKeywords(mapCninfoResponseToStandardItems(response), titleKeywords);
    }

    // Per-stock 错误隔离：任一 stock 失败不丢弃已成功结果；仅当全部失败才向上抛出，
    // 让 fetch handler 走 source failure 路径（不把空结果误判为成功）。
    const merged: StandardItem[] = [];
    const failedStocks: string[] = [];
    let lastError: unknown;
    for (const stock of stockCodes) {
      try {
        const response = await fetchFormPostWithPolicy(
          endpoint,
          buildCninfoFormParams({ ...config, stock }),
          {
            timeoutMs: 8000,
            useRealUa: ctx.useRealUa ?? true,
          }
        );
        merged.push(...mapCninfoResponseToStandardItems(response));
      } catch (error) {
        failedStocks.push(stock);
        lastError = error;
      }
    }

    if (failedStocks.length === stockCodes.length) {
      if (isRateLimitFetchError(lastError)) {
        return [];
      }
      if (lastError instanceof SourceFetchError) {
        throw lastError;
      }
      throw new SourceFetchError(
        "FETCH_ALL_STOCKS_FAILED",
        `CNINFO multi-stock fetch failed for all ${stockCodes.length} stock(s): ${failedStocks.join(",")}`,
        { url: endpoint, cause: lastError }
      );
    }

    return filterItemsByTitleKeywords(dedupeStandardItems(merged), titleKeywords);
  },
};
