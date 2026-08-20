import { and, eq } from "drizzle-orm";
import { clusterItems, clusters, getDb, itemAnalysis, items, sources } from "@fe-radar/db";
import { getRequestUser, requireFreshRole } from "@/lib/api/authz";
import { copilotDisabled, evaluateCopilotAccess } from "@/lib/api/copilot-access";
import { visibleItemConditions } from "@/lib/api/timeline-query";
import { webLogger } from "@/lib/logger";

import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authError = await requireFreshRole(request, "viewer");
  if (authError) return authError;

  const user = await getRequestUser(request);
  if (user.id === undefined) {
    return copilotDisabled();
  }

  try {
    const enabled = await evaluateCopilotAccess(user.id);
    if (!enabled) return copilotDisabled();
  } catch (err) {
    webLogger.error({ err }, "evaluateCopilotAccess failed");
    return copilotDisabled();
  }

  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return Response.json(
      { error: { code: "COPILOT_ITEM_NOT_FOUND", message: "条目不存在或不可引用" } },
      { status: 404 }
    );
  }

  const db = getDb();
  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      summaryZh: itemAnalysis.summaryZh,
      sourceName: sources.name,
      scoredAt: itemAnalysis.scoredAt
    })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .innerJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id))
    .leftJoin(clusterItems, eq(clusterItems.itemId, items.id))
    .leftJoin(clusters, eq(clusters.id, clusterItems.clusterId))
    .where(and(eq(items.id, itemId), visibleItemConditions({}, false, undefined, undefined, true, false)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return Response.json(
      { error: { code: "COPILOT_ITEM_NOT_FOUND", message: "条目不存在或不可引用" } },
      { status: 404 }
    );
  }

  return Response.json({
    id: row.id,
    title: row.title,
    summaryZh: row.summaryZh,
    sourceName: row.sourceName,
    scoredAt: row.scoredAt ? row.scoredAt.toISOString() : null
  });
}
