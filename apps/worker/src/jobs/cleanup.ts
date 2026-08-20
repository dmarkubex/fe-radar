import { and, isNull, lt, sql } from "drizzle-orm";
import {
  clusterItems,
  clusters,
  commodityBriefings,
  commodityQuotes,
  copilotAuditLog,
  copilotFeedbacks,
  copilotMessages,
  copilotSessions,
  dailyPushes,
  dailyReports,
  getDb,
  items,
} from "@fe-radar/db";
import { APP_TIMEZONE, createLogger, dayjs } from "@fe-radar/shared";

import type { DbClient } from "@fe-radar/db";

export const CLEANUP_RETENTION_DAYS = 90;
export const CLEANUP_SCHEDULE_CRON = "0 3 * * *";
export const CLEANUP_SCHEDULE_TZ = APP_TIMEZONE;

const logger = createLogger({ service: "cleanup" });

export interface CleanupResult {
  deletedItems: number;
  deletedDailyReports: number;
  deletedStaleClusters: number;
  deletedCommodityQuotes: number;
  deletedCommodityBriefings: number;
  deletedDailyPushes: number;
  deletedCopilotFeedbacks: number;
  deletedCopilotMessages: number;
  deletedCopilotAuditLog: number;
  deletedCopilotSessions: number;
}

export function retentionCutoff(now = new Date(), days = CLEANUP_RETENTION_DAYS): { timestamp: Date; date: string } {
  const cutoff = dayjs(now).tz(APP_TIMEZONE).subtract(days, "day");
  return {
    timestamp: cutoff.toDate(),
    date: cutoff.format("YYYY-MM-DD")
  };
}

export async function runCleanup(db: DbClient = getDb(), now = new Date()): Promise<CleanupResult> {
  const cutoff = retentionCutoff(now);

  // v1.1 retention cutoffs
  const quotesCutoff = dayjs(now).tz(APP_TIMEZONE).subtract(365, "day").toDate();
  const briefingsCutoff = dayjs(now).tz(APP_TIMEZONE).subtract(90, "day").format("YYYY-MM-DD");

  return db.transaction(async (tx) => {
    // v1.0 DELETEs (order preserved)
    const deletedDailyReports = await tx.delete(dailyReports).where(lt(dailyReports.date, cutoff.date)).returning({ date: dailyReports.date });
    const deletedItems = await tx.delete(items).where(lt(items.fetchedAt, cutoff.timestamp)).returning({ id: items.id });
    const deletedStaleClusters = await tx
      .delete(clusters)
      .where(and(
        isNull(clusters.leadItemId),
        sql`not exists (select 1 from ${clusterItems} ci where ci.cluster_id = ${clusters.id})`
      ))
      .returning({ id: clusters.id });

    // v1.1 DELETEs: commodity_quotes 365d + commodity_briefings 90d
    // briefing_pushes are deleted automatically via FK ON DELETE CASCADE
    // MinIO docx files are handled by MinIO bucket lifecycle policy (not here)
    const deletedCommodityQuotes = await tx
      .delete(commodityQuotes)
      .where(lt(commodityQuotes.observedAt, quotesCutoff))
      .returning({ id: commodityQuotes.id });

    const deletedCommodityBriefings = await tx
      .delete(commodityBriefings)
      .where(lt(commodityBriefings.briefingDate, briefingsCutoff))
      .returning({ id: commodityBriefings.id });

    // T-DUP gate-B: daily_pushes audit 90d (by report_date)
    const deletedDailyPushes = await tx
      .delete(dailyPushes)
      .where(lt(dailyPushes.reportDate, cutoff.date))
      .returning({ id: dailyPushes.id });

    // v1.3 copilot: same tx, child-before-parent (design.md §3.5 L942–947).
    // feedbacks/messages: createdAt < cutoff90 — a session with fresh lastActive
    // still loses messages older than 90 days (fixture: last_active new, message 100d ago).
    // audit_log: 365d. sessions: lastActive < cutoff90.
    // Do not delete the grayscale switch table. Fulltext rows follow items 90d CASCADE.
    const deletedCopilotFeedbacks = await tx
      .delete(copilotFeedbacks)
      .where(lt(copilotFeedbacks.createdAt, cutoff.timestamp))
      .returning({ id: copilotFeedbacks.id });

    const deletedCopilotMessages = await tx
      .delete(copilotMessages)
      .where(lt(copilotMessages.createdAt, cutoff.timestamp))
      .returning({ id: copilotMessages.id });

    const deletedCopilotAuditLog = await tx
      .delete(copilotAuditLog)
      .where(lt(copilotAuditLog.createdAt, quotesCutoff))
      .returning({ id: copilotAuditLog.id });

    const deletedCopilotSessions = await tx
      .delete(copilotSessions)
      .where(lt(copilotSessions.lastActive, cutoff.timestamp))
      .returning({ id: copilotSessions.id });

    logger.info({ rowsDeleted: deletedCommodityQuotes.length, table: "commodity_quotes", retentionDays: 365 }, "cleanup");
    logger.info({ rowsDeleted: deletedCommodityBriefings.length, table: "commodity_briefings", retentionDays: 90 }, "cleanup");
    logger.info({ rowsDeleted: deletedDailyPushes.length, table: "daily_pushes", retentionDays: 90 }, "cleanup");
    logger.info({ rowsDeleted: deletedCopilotFeedbacks.length, table: "copilot.feedbacks", retentionDays: 90 }, "cleanup");
    logger.info({ rowsDeleted: deletedCopilotMessages.length, table: "copilot.messages", retentionDays: 90 }, "cleanup");
    logger.info({ rowsDeleted: deletedCopilotAuditLog.length, table: "copilot.audit_log", retentionDays: 365 }, "cleanup");
    logger.info({ rowsDeleted: deletedCopilotSessions.length, table: "copilot.sessions", retentionDays: 90 }, "cleanup");

    return {
      deletedItems: deletedItems.length,
      deletedDailyReports: deletedDailyReports.length,
      deletedStaleClusters: deletedStaleClusters.length,
      deletedCommodityQuotes: deletedCommodityQuotes.length,
      deletedCommodityBriefings: deletedCommodityBriefings.length,
      deletedDailyPushes: deletedDailyPushes.length,
      deletedCopilotFeedbacks: deletedCopilotFeedbacks.length,
      deletedCopilotMessages: deletedCopilotMessages.length,
      deletedCopilotAuditLog: deletedCopilotAuditLog.length,
      deletedCopilotSessions: deletedCopilotSessions.length,
    };
  });
}
