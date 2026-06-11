import { eq } from "drizzle-orm";
import { entities, getDb } from "@fe-radar/db";
import { requireRequestRole } from "@/lib/api/authz";
import { updateEntitySchema, validationError } from "@/lib/api/entities-schema";

import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<Response> {
  const authError = await requireRequestRole(request, "editor");
  if (authError) return authError;

  const { id } = await context.params;
  const parsed = updateEntitySchema.safeParse(await request.json());
  if (!parsed.success) {
    return validationError(parsed.error.flatten());
  }
  const [entity] = await getDb().update(entities).set(parsed.data).where(eq(entities.id, Number(id))).returning();
  if (!entity) {
    return Response.json({ error: { code: "NOT_FOUND", message: "实体不存在" } }, { status: 404 });
  }
  return Response.json(entity);
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  const authError = await requireRequestRole(request, "editor");
  if (authError) return authError;

  const { id } = await context.params;
  const [entity] = await getDb().delete(entities).where(eq(entities.id, Number(id))).returning();
  if (!entity) {
    return Response.json({ error: { code: "NOT_FOUND", message: "实体不存在" } }, { status: 404 });
  }
  return Response.json(entity);
}
