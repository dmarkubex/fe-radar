import { eq } from "drizzle-orm";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getDb, commodityBriefings } from "@fe-radar/db";
import { getRequestUser } from "@/lib/api/authz";
import { hasRole } from "@/lib/auth/rbac";
import { validationError } from "@/lib/api/briefing-schema";
import { regenerateSchema } from "@/lib/api/briefing-schema";

import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const user = await getRequestUser(request);
  if (!user.role) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
  }
  if (!hasRole(user.role, "editor")) {
    return Response.json({ error: { code: "FORBIDDEN", message: "权限不足" } }, { status: 403 });
  }

  const { id } = await context.params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return Response.json({ error: { code: "NOT_FOUND", message: "条目不存在或不可访问" } }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = regenerateSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error.flatten());
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

  // Enqueue briefing-gen job (fire-and-forget, do not await completion)
  const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  try {
    const queue = new Queue("fe:briefing-gen", { connection });
    await queue.add("regenerate", { briefingId: numId, briefingDate: briefing.briefingDate, force: parsed.data.force });
  } finally {
    await connection.quit();
  }

  return Response.json({ ok: true, briefingId: numId }, { status: 202 });
}
