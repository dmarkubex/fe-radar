/**
 * T-CA-05 / design §3.6：detail-fetch consumer。
 *
 * 入队后重查 `item_analysis.is_curated OR alert_type IN (own/safety/policy/legal/risk)`。
 * 不满足则 skip。满足则复用 `runDetailFetch`（与 /internal/fulltext 同一条下载链）。
 */
import { eq } from "drizzle-orm";
import { getDb, itemAnalysis } from "@fe-radar/db";
import { createLogger } from "@fe-radar/shared";

import { runDetailFetch } from "../internal/fulltext";

const logger = createLogger({ service: "detail-fetch" });

const ALERT_TYPES = new Set(["own", "safety", "policy", "legal", "risk"]);

export async function handleDetailFetchJob(itemId: number): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      isCurated: itemAnalysis.isCurated,
      alertType: itemAnalysis.alertType
    })
    .from(itemAnalysis)
    .where(eq(itemAnalysis.itemId, itemId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    logger.debug({ itemId }, "detail-fetch skipped: no item_analysis");
    return;
  }
  const alertType = row.alertType;
  const eligible = row.isCurated === true || (typeof alertType === "string" && ALERT_TYPES.has(alertType));
  if (!eligible) {
    logger.debug({ itemId, isCurated: row.isCurated, alertType }, "detail-fetch skipped: not curated/alert");
    return;
  }
  await runDetailFetch(itemId);
}
