import { eq, isNull } from "drizzle-orm";
import { getDb, briefingTargets } from "@fe-radar/db";
import { getRequestUser, unauthorized, forbidden } from "@/lib/api/authz";
import { createTargetSchema, validationError } from "@/lib/api/briefing-schema";

import type { NextRequest } from "next/server";

function maskSecret(target: typeof briefingTargets.$inferSelect) {
  return {
    ...target,
    signSecret: target.signSecret ? "***" : null
  };
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getRequestUser(request);
  if (!user.role) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const db = getDb();
  const rows = await db
    .select()
    .from(briefingTargets)
    .where(isNull(briefingTargets.disabledAt))
    .orderBy(briefingTargets.id);

  return Response.json({ items: rows.map(maskSecret) });
}

export async function POST(request: NextRequest): Promise<Response> {
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

  return Response.json(maskSecret(created!), { status: 201 });
}
