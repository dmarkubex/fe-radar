import { and, desc, eq, gte } from "drizzle-orm";
import { getDb, commodityQuotes } from "@fe-radar/db";
import { getRequestUser } from "@/lib/api/authz";

import type { NextRequest } from "next/server";

/**
 * GET /api/quotes/latest?metric_key=cu_main_close&days=7
 *
 * Returns the last N days of quotes for a given metric_key, ordered by
 * observed_at ASC (oldest first, for chart rendering).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const user = await getRequestUser(request);
  if (!user.role) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const metricKey = searchParams.get("metric_key");
  const daysParam = searchParams.get("days");

  if (!metricKey) {
    return Response.json(
      { error: { code: "VALIDATION", message: "metric_key 参数必填" } },
      { status: 400 }
    );
  }

  const days = daysParam ? Math.min(Math.max(Number(daysParam), 1), 90) : 7;
  if (!Number.isFinite(days)) {
    return Response.json(
      { error: { code: "VALIDATION", message: "days 参数无效" } },
      { status: 400 }
    );
  }

  const since = new Date();
  since.setDate(since.getDate() - days);

  const db = getDb();
  const rows = await db
    .select({
      observedAt: commodityQuotes.observedAt,
      value: commodityQuotes.value,
      changePct: commodityQuotes.changePct,
    })
    .from(commodityQuotes)
    .where(
      and(
        eq(commodityQuotes.metricKey, metricKey),
        gte(commodityQuotes.observedAt, since)
      )
    )
    .orderBy(commodityQuotes.observedAt);

  return Response.json({ metricKey, days, items: rows });
}
