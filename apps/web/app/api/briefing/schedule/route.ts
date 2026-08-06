import { desc, eq } from "drizzle-orm";
import { getDb, dailyPushConfig, dailyPushes } from "@fe-radar/db";
import { getRequestUser, unauthorized, forbidden } from "@/lib/api/authz";
import { scheduleConfigSchema, validationError } from "@/lib/api/briefing-schema";

import type { NextRequest } from "next/server";

const CONFIG_ID = 1;
const RECENT_PUSH_LIMIT = 10;

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getRequestUser(request);
  if (!user.role) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const db = getDb();
  const [config] = await db
    .select()
    .from(dailyPushConfig)
    .where(eq(dailyPushConfig.id, CONFIG_ID))
    .limit(1);

  if (!config) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "调度配置不存在，请先执行 migration 0055" } },
      { status: 404 }
    );
  }

  const recentPushes = await db
    .select({
      id: dailyPushes.id,
      reportDate: dailyPushes.reportDate,
      targetId: dailyPushes.targetId,
      briefingId: dailyPushes.briefingId,
      dailyReportPresent: dailyPushes.dailyReportPresent,
      briefingPresent: dailyPushes.briefingPresent,
      pushStatus: dailyPushes.pushStatus,
      attemptCount: dailyPushes.attemptCount,
      errorDetail: dailyPushes.errorDetail,
      pushedAt: dailyPushes.pushedAt,
    })
    .from(dailyPushes)
    .orderBy(desc(dailyPushes.id))
    .limit(RECENT_PUSH_LIMIT);

  return Response.json({
    config: {
      id: config.id,
      enabled: config.enabled,
      sendTime: config.sendTime,
      scheduleMode: config.scheduleMode,
      baseUrl: config.baseUrl,
      updatedBy: config.updatedBy,
      updatedAt: config.updatedAt,
    },
    recentPushes,
    timezone: "Asia/Shanghai",
  });
}

export async function PUT(request: NextRequest): Promise<Response> {
  const user = await getRequestUser(request);
  if (!user.role) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const parsed = scheduleConfigSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error.flatten());

  const db = getDb();
  const now = new Date();

  const [updated] = await db
    .update(dailyPushConfig)
    .set({
      enabled: parsed.data.enabled,
      sendTime: parsed.data.sendTime,
      scheduleMode: parsed.data.scheduleMode,
      baseUrl: parsed.data.baseUrl,
      updatedBy: user.id ?? null,
      updatedAt: now,
    })
    .where(eq(dailyPushConfig.id, CONFIG_ID))
    .returning();

  if (!updated) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "调度配置不存在，请先执行 migration 0055" } },
      { status: 404 }
    );
  }

  return Response.json({
    config: {
      id: updated.id,
      enabled: updated.enabled,
      sendTime: updated.sendTime,
      scheduleMode: updated.scheduleMode,
      baseUrl: updated.baseUrl,
      updatedBy: updated.updatedBy,
      updatedAt: updated.updatedAt,
    },
    timezone: "Asia/Shanghai",
  });
}
