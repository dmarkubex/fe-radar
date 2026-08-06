import { eq } from "drizzle-orm";
import { getDb, briefingTargets } from "@fe-radar/db";
import { getRequestUser, unauthorized, forbidden, notFound } from "@/lib/api/authz";
import {
  toPublicTarget,
  updateTargetSchema,
  validationError,
} from "@/lib/api/briefing-schema";

import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<Response> {
  const user = await getRequestUser(request);
  if (!user.role) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const { id } = await context.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return notFound();

  const body = await request.json() as Record<string, unknown>;
  const parsed = updateTargetSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.flatten());

  const db = getDb();

  // Build update payload:
  // - webhookUrl: only when explicitly provided as non-empty valid URL
  // - signSecret: empty string / omit → keep existing; non-empty → update
  const updateData: Partial<typeof briefingTargets.$inferInsert> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.enabled !== undefined) updateData.enabled = parsed.data.enabled;
  if (
    parsed.data.webhookUrl !== undefined &&
    parsed.data.webhookUrl.trim() !== ""
  ) {
    updateData.webhookUrl = parsed.data.webhookUrl.trim();
  }
  if (parsed.data.signSecret !== undefined && parsed.data.signSecret !== "") {
    updateData.signSecret = parsed.data.signSecret;
  }
  // Explicit null clears sign secret (nullable optional in schema)
  if (parsed.data.signSecret === null) {
    updateData.signSecret = null;
  }

  const [updated] = await db
    .update(briefingTargets)
    .set(updateData)
    .where(eq(briefingTargets.id, numId))
    .returning();

  if (!updated) return notFound();
  return Response.json(toPublicTarget(updated));
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  const user = await getRequestUser(request);
  if (!user.role) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const { id } = await context.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return notFound();

  const db = getDb();
  // Soft delete: set disabled_at = now() and enabled = false
  const [updated] = await db
    .update(briefingTargets)
    .set({ disabledAt: new Date(), enabled: false })
    .where(eq(briefingTargets.id, numId))
    .returning();

  if (!updated) return notFound();
  return Response.json({ ok: true });
}
