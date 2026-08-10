import { eq } from "drizzle-orm";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getDb, commodityBriefings } from "@fe-radar/db";
import { getRequestUser, requireFreshRole } from "@/lib/api/authz";
import { hasRole } from "@/lib/auth/rbac";

import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  // T-SEC-06 (复核 HIGH-3): repush 是 admin 高权限动作（触发钉钉推送），查 DB 校验 token 新鲜度。
  const freshError = await requireFreshRole(request, "admin");
  if (freshError) return freshError;
  const user = await getRequestUser(request);
  if (!user.role) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
  }
  if (!hasRole(user.role, "admin")) {
    return Response.json({ error: { code: "FORBIDDEN", message: "权限不足" } }, { status: 403 });
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

  // Enqueue briefing-push job (fire-and-forget)
  const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  try {
    const queue = new Queue("fe-briefing-push", { connection });
    await queue.add("repush", {
      kind: "briefing-repush",
      briefingId: numId,
      briefingDate: briefing.briefingDate,
      trigger: "manual" as const,
    });
  } finally {
    await connection.quit();
  }

  return Response.json({ ok: true, briefingId: numId }, { status: 202 });
}
