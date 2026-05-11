import { and, isNull, lt, sql } from "drizzle-orm";
import { clusterItems, clusters, dailyReports, getDb, items } from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

import type { DbClient } from "@fe-radar/db";

export const CLEANUP_RETENTION_DAYS = 90;
export const CLEANUP_SCHEDULE_CRON = "0 3 * * *";
export const CLEANUP_SCHEDULE_TZ = APP_TIMEZONE;

export interface CleanupResult {
  deletedItems: number;
  deletedDailyReports: number;
  deletedStaleClusters: number;
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
  return db.transaction(async (tx) => {
    const deletedDailyReports = await tx.delete(dailyReports).where(lt(dailyReports.date, cutoff.date)).returning({ date: dailyReports.date });
    const deletedItems = await tx.delete(items).where(lt(items.fetchedAt, cutoff.timestamp)).returning({ id: items.id });
    const deletedStaleClusters = await tx
      .delete(clusters)
      .where(and(
        isNull(clusters.leadItemId),
        sql`not exists (select 1 from ${clusterItems} ci where ci.cluster_id = ${clusters.id})`
      ))
      .returning({ id: clusters.id });

    return {
      deletedItems: deletedItems.length,
      deletedDailyReports: deletedDailyReports.length,
      deletedStaleClusters: deletedStaleClusters.length
    };
  });
}
