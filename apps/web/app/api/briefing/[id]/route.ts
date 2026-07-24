import { eq } from "drizzle-orm";
import { getDb, commodityBriefings, briefingPushes, briefingTargets } from "@fe-radar/db";
import { getRequestUser } from "@/lib/api/authz";

import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const user = await getRequestUser(request);
  if (!user.role) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
  }

  const { id } = await context.params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return Response.json({ error: { code: "NOT_FOUND", message: "条目不存在或不可访问" } }, { status: 404 });
  }

  const db = getDb();
  const [briefing] = await db
    .select()
    .from(commodityBriefings)
    .where(eq(commodityBriefings.id, numId))
    .limit(1);

  if (!briefing) {
    return Response.json({ error: { code: "NOT_FOUND", message: "条目不存在或不可访问" } }, { status: 404 });
  }

  // Fetch push status list (join targets for name display, mask sign_secret)
  const pushes = await db
    .select({
      id: briefingPushes.id,
      targetId: briefingPushes.targetId,
      targetName: briefingTargets.name,
      pushStatus: briefingPushes.pushStatus,
      attemptCount: briefingPushes.attemptCount,
      errorDetail: briefingPushes.errorDetail,
      pushedAt: briefingPushes.pushedAt
    })
    .from(briefingPushes)
    .leftJoin(briefingTargets, eq(briefingPushes.targetId, briefingTargets.id))
    .where(eq(briefingPushes.briefingId, numId));

  const visiblePushes = pushes.map(({ errorDetail, ...push }) =>
    user.role === "admin" ? { ...push, errorDetail } : push
  );

  return Response.json({ briefing, pushes: visiblePushes });
}
