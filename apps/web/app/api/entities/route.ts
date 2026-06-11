import { desc } from "drizzle-orm";
import { entities, getDb } from "@fe-radar/db";
import { requireRequestRole } from "@/lib/api/authz";
import { entityBodySchema, validationError } from "@/lib/api/entities-schema";

import type { NextRequest } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  const authError = await requireRequestRole(request, "editor");
  if (authError) return authError;

  const rows = await getDb().select().from(entities).orderBy(desc(entities.id));
  return Response.json({ items: rows });
}

export async function POST(request: NextRequest): Promise<Response> {
  const authError = await requireRequestRole(request, "editor");
  if (authError) return authError;

  const parsed = entityBodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return validationError(parsed.error.flatten());
  }
  const [entity] = await getDb().insert(entities).values(parsed.data).returning();
  return Response.json(entity, { status: 201 });
}
