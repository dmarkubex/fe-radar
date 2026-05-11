import { and, eq, gte, isNotNull } from "drizzle-orm";
import { getDb, itemAnalysis } from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

export async function GET(): Promise<Response> {
  const start = dayjs().tz(APP_TIMEZONE).startOf("day").toDate();
  const rows = await getDb()
    .select({ alertType: itemAnalysis.alertType })
    .from(itemAnalysis)
    .where(and(gte(itemAnalysis.scoredAt, start), isNotNull(itemAnalysis.alertType), eq(itemAnalysis.quotaState, "admitted")));

  const count = { own: 0, safety: 0, policy: 0 };
  for (const row of rows) {
    if (row.alertType === "own" || row.alertType === "safety" || row.alertType === "policy") {
      count[row.alertType] += 1;
    }
  }

  return Response.json(count);
}
