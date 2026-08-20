import { eq } from "drizzle-orm";
import { z } from "zod";
import { copilotFeatureFlags, getDb } from "@fe-radar/db";
import { getRequestUser, requireFreshRole } from "@/lib/api/authz";

import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const FLAG_KEY = "copilot";

const putSchema = z.object({
  enabled: z.boolean(),
  userIds: z.array(z.number().int()),
  depts: z.array(z.string())
});

function toDto(row: {
  enabled: boolean;
  userIds: number[] | null;
  depts: string[] | null;
  updatedAt: Date | null;
  updatedBy: number | null;
}): {
  enabled: boolean;
  userIds: number[];
  depts: string[];
  updatedAt: string | null;
  updatedBy: number | null;
} {
  return {
    enabled: row.enabled,
    userIds: row.userIds ?? [],
    depts: row.depts ?? [],
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    updatedBy: row.updatedBy
  };
}

export async function GET(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "admin");
  if (authError) return authError;

  const [row] = await getDb()
    .select({
      enabled: copilotFeatureFlags.enabled,
      userIds: copilotFeatureFlags.userIds,
      depts: copilotFeatureFlags.depts,
      updatedAt: copilotFeatureFlags.updatedAt,
      updatedBy: copilotFeatureFlags.updatedBy
    })
    .from(copilotFeatureFlags)
    .where(eq(copilotFeatureFlags.key, FLAG_KEY))
    .limit(1);

  if (!row) {
    return Response.json({
      enabled: false,
      userIds: [],
      depts: [],
      updatedAt: null,
      updatedBy: null
    });
  }
  return Response.json(toDto(row));
}

export async function PUT(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "admin");
  if (authError) return authError;

  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION", message: "参数校验失败", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  const user = await getRequestUser(request);
  const now = new Date();
  const [updated] = await getDb()
    .update(copilotFeatureFlags)
    .set({
      enabled: parsed.data.enabled,
      userIds: parsed.data.userIds,
      depts: parsed.data.depts,
      updatedAt: now,
      updatedBy: user.id ?? null
    })
    .where(eq(copilotFeatureFlags.key, FLAG_KEY))
    .returning({
      enabled: copilotFeatureFlags.enabled,
      userIds: copilotFeatureFlags.userIds,
      depts: copilotFeatureFlags.depts,
      updatedAt: copilotFeatureFlags.updatedAt,
      updatedBy: copilotFeatureFlags.updatedBy
    });

  if (!updated) {
    const [inserted] = await getDb()
      .insert(copilotFeatureFlags)
      .values({
        key: FLAG_KEY,
        enabled: parsed.data.enabled,
        userIds: parsed.data.userIds,
        depts: parsed.data.depts,
        updatedAt: now,
        updatedBy: user.id ?? null
      })
      .returning({
        enabled: copilotFeatureFlags.enabled,
        userIds: copilotFeatureFlags.userIds,
        depts: copilotFeatureFlags.depts,
        updatedAt: copilotFeatureFlags.updatedAt,
        updatedBy: copilotFeatureFlags.updatedBy
      });
    if (!inserted) {
      return Response.json(
        { error: { code: "COPILOT_FLAG_WRITE_FAILED", message: "无法写入灰度开关" } },
        { status: 500 }
      );
    }
    return Response.json(toDto(inserted));
  }

  return Response.json(toDto(updated));
}
