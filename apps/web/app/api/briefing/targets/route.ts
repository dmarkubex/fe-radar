import { isNull } from "drizzle-orm";
import { getDb, briefingTargets } from "@fe-radar/db";
import { getRequestUser, unauthorized, forbidden, requireFreshRole } from "@/lib/api/authz";
import {
  createTargetSchema,
  toPublicTarget,
  validationError,
} from "@/lib/api/briefing-schema";

import type { NextRequest } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  // T-SEC-06 (复核 HIGH-3): targets 是 admin 路径。
  const freshError = await requireFreshRole(request, "admin");
  if (freshError) return freshError;
  const user = await getRequestUser(request);
  if (!user.role) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const db = getDb();
  const rows = await db
    .select()
    .from(briefingTargets)
    .where(isNull(briefingTargets.disabledAt))
    .orderBy(briefingTargets.id);

  return Response.json({ items: rows.map(toPublicTarget) });
}

export async function POST(request: NextRequest): Promise<Response> {
  const freshError = await requireFreshRole(request, "admin");
  if (freshError) return freshError;
  const user = await getRequestUser(request);
  if (!user.role) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const parsed = createTargetSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error.flatten());

  const db = getDb();
  const [created] = await db
    .insert(briefingTargets)
    .values({
      name: parsed.data.name,
      channel: parsed.data.channel,
      webhookUrl: parsed.data.webhookUrl,
      signSecret: parsed.data.signSecret ?? null,
      enabled: parsed.data.enabled ?? true,
      createdBy: user.id ?? null
    })
    .returning();

  return Response.json(toPublicTarget(created!), { status: 201 });
}
