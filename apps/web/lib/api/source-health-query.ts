import { asc, count, gte } from "drizzle-orm";
import { getDb, items, sources } from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

import type { DbClient } from "@fe-radar/db";
import { isMockMode } from "@/lib/mock-mode";

const STALE_HOURS_THRESHOLD = 12;
const FAILING_FAIL_COUNT = 3;

export type SourceTier = "T1" | "T2" | "T3";
export type SourceHealthStatus = "healthy" | "stale" | "failing" | "disabled";

export interface SourceHealthRow {
  id: number;
  name: string;
  tier: SourceTier;
  fetcherType: string;
  enabled: boolean;
  lastOkAtIso: string | null;
  failCount: number;
  health: SourceHealthStatus;
  staleHours: number | null;
  nextFetchIso: string | null;
  lastError: string | null;
  lastErrorAtIso: string | null;
}

export interface SourceHealthSummary {
  healthy: number;
  stale: number;
  failing: number;
  disabled: number;
  fetched24h: number;
}

export interface SourceHealthPayload {
  summary: SourceHealthSummary;
  sources: SourceHealthRow[];
}

// worst-first 排序权重：failing > disabled > stale > healthy
const HEALTH_ORDER: Record<SourceHealthStatus, number> = {
  failing: 0,
  disabled: 1,
  stale: 2,
  healthy: 3
};

function computeHealth(enabled: boolean, failCount: number, lastOkAt: Date | null): SourceHealthStatus {
  if (!enabled) return "disabled";
  if (failCount >= FAILING_FAIL_COUNT) return "failing";
  if (lastOkAt === null) return "stale";
  const hours = dayjs().tz(APP_TIMEZONE).diff(dayjs(lastOkAt).tz(APP_TIMEZONE), "hour", true);
  if (hours > STALE_HOURS_THRESHOLD) return "stale";
  return "healthy";
}

function computeStaleHours(lastOkAt: Date | null): number | null {
  if (lastOkAt === null) return null;
  const hours = dayjs().tz(APP_TIMEZONE).diff(dayjs(lastOkAt).tz(APP_TIMEZONE), "hour", true);
  return Math.max(0, Math.round(hours * 10) / 10);
}

// 新闻类抓取 cron "0 */6 * * *"：下一个整 6 小时点（0/6/12/18），Asia/Shanghai。
function computeNextFetchIso(): string {
  const now = dayjs().tz(APP_TIMEZONE);
  const nextHour = (Math.floor(now.hour() / 6) + 1) * 6; // 6,12,18,24
  return now.startOf("hour").add(nextHour - now.hour(), "hour").toISOString();
}

// 行情(quotes)抓取 cron "0 30 15 * * 1-5"：下一个工作日 15:30，Asia/Shanghai。
function computeNextQuotesFetchIso(): string {
  const now = dayjs().tz(APP_TIMEZONE);
  let candidate = now.hour(15).minute(30).second(0).millisecond(0);
  if (!candidate.isAfter(now)) candidate = candidate.add(1, "day");
  while (candidate.day() === 0 || candidate.day() === 6) candidate = candidate.add(1, "day"); // skip Sun/Sat
  return candidate.toISOString();
}

// 按 fetcherType 选择对应调度：quotes 走行情 cron，其它走新闻 cron；停用源无下次抓取。
function nextFetchForSource(fetcherType: string, enabled: boolean): string | null {
  if (!enabled) return null;
  if (fetcherType === "quotes") return computeNextQuotesFetchIso();
  return computeNextFetchIso();
}

function buildPayload(
  rows: Array<{
    id: number;
    name: string;
    tier: string;
    fetcherType: string;
    enabled: boolean;
    lastOkAt: Date | null;
    failCount: number;
    lastError: string | null;
    lastErrorAt: Date | null;
  }>,
  fetched24h: number
): SourceHealthPayload {
  const summary: SourceHealthSummary = { healthy: 0, stale: 0, failing: 0, disabled: 0, fetched24h };

  const mapped: SourceHealthRow[] = rows.map((row) => {
    const health = computeHealth(row.enabled, row.failCount, row.lastOkAt);
    summary[health] += 1;
    return {
      id: row.id,
      name: row.name,
      tier: row.tier as SourceTier,
      fetcherType: row.fetcherType,
      enabled: row.enabled,
      lastOkAtIso: row.lastOkAt ? row.lastOkAt.toISOString() : null,
      failCount: row.failCount,
      health,
      staleHours: computeStaleHours(row.lastOkAt),
      nextFetchIso: nextFetchForSource(row.fetcherType, row.enabled),
      lastError: row.lastError,
      lastErrorAtIso: row.lastErrorAt ? row.lastErrorAt.toISOString() : null
    };
  });

  mapped.sort((a, b) => {
    const orderDiff = HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health];
    if (orderDiff !== 0) return orderDiff;
    return b.failCount - a.failCount;
  });

  return { summary, sources: mapped };
}

export function mockSourceHealth(): SourceHealthPayload {
  const nextFetchIso = computeNextFetchIso();
  return {
    summary: { healthy: 2, stale: 1, failing: 1, disabled: 1, fetched24h: 42 },
    sources: [
      {
        id: 4,
        name: "国家能源局",
        tier: "T1",
        fetcherType: "playwright",
        enabled: true,
        lastOkAtIso: dayjs().tz(APP_TIMEZONE).subtract(20, "hour").toISOString(),
        failCount: 5,
        health: "failing",
        staleHours: 20,
        nextFetchIso,
        lastError: "fetch failed: HTTP 503 from https://www.nea.gov.cn (proxy pool exhausted)",
        lastErrorAtIso: dayjs().tz(APP_TIMEZONE).subtract(20, "hour").toISOString()
      },
      {
        id: 5,
        name: "工信部停用源",
        tier: "T2",
        fetcherType: "rss",
        enabled: false,
        lastOkAtIso: dayjs().tz(APP_TIMEZONE).subtract(48, "hour").toISOString(),
        failCount: 0,
        health: "disabled",
        staleHours: 48,
        nextFetchIso: null,
        lastError: null,
        lastErrorAtIso: null
      },
      {
        id: 3,
        name: "上海有色网 SMM",
        tier: "T2",
        fetcherType: "rss",
        enabled: true,
        lastOkAtIso: dayjs().tz(APP_TIMEZONE).subtract(15, "hour").toISOString(),
        failCount: 1,
        health: "stale",
        staleHours: 15,
        nextFetchIso,
        lastError: null,
        lastErrorAtIso: null
      },
      {
        id: 1,
        name: "北极星储能网",
        tier: "T1",
        fetcherType: "rss",
        enabled: true,
        lastOkAtIso: dayjs().tz(APP_TIMEZONE).subtract(2, "hour").toISOString(),
        failCount: 0,
        health: "healthy",
        staleHours: 2,
        nextFetchIso,
        lastError: null,
        lastErrorAtIso: null
      },
      {
        id: 2,
        name: "中国能源报",
        tier: "T2",
        fetcherType: "html",
        enabled: true,
        lastOkAtIso: dayjs().tz(APP_TIMEZONE).subtract(1, "hour").toISOString(),
        failCount: 0,
        health: "healthy",
        staleHours: 1,
        nextFetchIso,
        lastError: null,
        lastErrorAtIso: null
      }
    ]
  };
}

export async function fetchSourceHealth(db?: DbClient): Promise<SourceHealthPayload> {
  if (isMockMode()) {
    return mockSourceHealth();
  }
  const client = db ?? getDb();
  const [rows, fetched24hRows] = await Promise.all([
    client
      .select({
        id: sources.id,
        name: sources.name,
        tier: sources.tier,
        fetcherType: sources.fetcherType,
        enabled: sources.enabled,
        lastOkAt: sources.lastOkAt,
        failCount: sources.failCount,
        lastError: sources.lastError,
        lastErrorAt: sources.lastErrorAt
      })
      .from(sources)
      .orderBy(asc(sources.id)),
    (async () => {
      const cutoff = dayjs().tz(APP_TIMEZONE).subtract(24, "hour").toDate();
      const [row] = await client
        .select({ value: count() })
        .from(items)
        .where(gte(items.fetchedAt, cutoff));
      return Number(row?.value ?? 0);
    })()
  ]);

  return buildPayload(rows, fetched24hRows);
}
