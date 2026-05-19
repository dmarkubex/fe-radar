import { and, count, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import {
  auditLogs,
  feedbacks,
  getDb,
  itemAnalysis,
  items,
  mergeConflicts,
  sources
} from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

import type { DbClient } from "@fe-radar/db";
import { isMockMode } from "@/lib/mock-mode";
import { mockFetchDashboardData } from "@/lib/mock-data";

const MANUAL_SCRUB_SUMMARY = "[需人工脱敏]";

export interface DashboardMetric {
  label: string;
  value: number | string;
  tone?: "default" | "warning" | "critical";
}

export interface DashboardData {
  metrics: DashboardMetric[];
  backlog: {
    pending: number;
    droppedExpired: number;
    oldPending: number;
    oldPendingRatio: number;
    tone: "default" | "warning" | "critical";
  };
  sources: {
    total: number;
    disabled: number;
    failedSevenDays: number;
  };
  alertsToday: {
    own: number;
    safety: number;
    policy: number;
  };
  mergeConflictsPending: number;
  scrubberPending: number;
  recentAuditCount: number;
}

export async function fetchDashboardData(db?: DbClient): Promise<DashboardData> {
  if (isMockMode()) {
    return mockFetchDashboardData();
  }
  db ??= getDb();
  const now = dayjs().tz(APP_TIMEZONE);
  const startOfDay = now.startOf("day").toDate();
  const oldCutoff = now.subtract(24, "hour").toDate();

  const [
    [sourceTotals],
    [itemTotals],
    [feedbackTotals],
    [mergeConflictTotals],
    [scrubberTotals],
    [pendingTotals],
    [droppedTotals],
    [oldPendingTotals],
    [recentAuditTotals],
    alertRows
  ] = await Promise.all([
    db.select({
      total: count(),
      disabled: sql<number>`count(*) filter (where ${sources.enabled} = false)::int`,
      failedSevenDays: sql<number>`count(*) filter (where ${sources.failCount} >= 7)::int`
    }).from(sources),
    db.select({
      total: count(),
      scored: sql<number>`count(${itemAnalysis.itemId})::int`,
      curated: sql<number>`count(*) filter (where ${itemAnalysis.isCurated} = true)::int`
    }).from(items).leftJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id)),
    db.select({ total: count() }).from(feedbacks),
    db.select({ total: count() }).from(mergeConflicts).where(eq(mergeConflicts.status, "pending")),
    db.select({ total: count() }).from(itemAnalysis).where(eq(itemAnalysis.summaryZh, MANUAL_SCRUB_SUMMARY)),
    db.select({ total: count() }).from(itemAnalysis).where(eq(itemAnalysis.quotaState, "pending_over_quota")),
    db.select({ total: count() }).from(itemAnalysis).where(eq(itemAnalysis.quotaState, "dropped_quota_expired")),
    db
      .select({ total: count() })
      .from(items)
      .innerJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id))
      .where(and(eq(itemAnalysis.quotaState, "pending_over_quota"), lt(items.fetchedAt, oldCutoff))),
    db.select({ total: count() }).from(auditLogs).where(gte(auditLogs.createdAt, now.subtract(7, "day").toDate())),
    db.select({ alertType: itemAnalysis.alertType }).from(itemAnalysis).where(and(gte(itemAnalysis.scoredAt, startOfDay), isNotNull(itemAnalysis.alertType)))
  ]);

  const pending = pendingTotals?.total ?? 0;
  const oldPending = oldPendingTotals?.total ?? 0;
  const oldPendingRatio = pending === 0 ? 0 : oldPending / pending;
  const backlogTone = oldPendingRatio > 0.5 ? "critical" : oldPendingRatio > 0.3 ? "warning" : "default";
  const alertsToday = { own: 0, safety: 0, policy: 0 };
  for (const row of alertRows) {
    if (row.alertType === "own" || row.alertType === "safety" || row.alertType === "policy") {
      alertsToday[row.alertType] += 1;
    }
  }

  return {
    metrics: [
      { label: "信源", value: sourceTotals?.total ?? 0 },
      { label: "已评分", value: itemTotals?.scored ?? 0 },
      { label: "精选", value: itemTotals?.curated ?? 0 },
      { label: "反馈", value: feedbackTotals?.total ?? 0 },
      { label: "人工脱敏", value: scrubberTotals?.total ?? 0, tone: (scrubberTotals?.total ?? 0) > 0 ? "warning" : "default" },
      { label: "合并冲突", value: mergeConflictTotals?.total ?? 0, tone: (mergeConflictTotals?.total ?? 0) > 0 ? "warning" : "default" },
      { label: "Priority 老化", value: `${Math.round(oldPendingRatio * 100)}%`, tone: backlogTone }
    ],
    backlog: {
      pending,
      droppedExpired: droppedTotals?.total ?? 0,
      oldPending,
      oldPendingRatio,
      tone: backlogTone
    },
    sources: {
      total: sourceTotals?.total ?? 0,
      disabled: sourceTotals?.disabled ?? 0,
      failedSevenDays: sourceTotals?.failedSevenDays ?? 0
    },
    alertsToday,
    mergeConflictsPending: mergeConflictTotals?.total ?? 0,
    scrubberPending: scrubberTotals?.total ?? 0,
    recentAuditCount: recentAuditTotals?.total ?? 0
  };
}
