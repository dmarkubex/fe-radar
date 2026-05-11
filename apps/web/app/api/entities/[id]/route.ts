import { eq } from "drizzle-orm";
import { entities, getDb } from "@fe-radar/db";
import { updateEntitySchema, validationError } from "@/lib/api/entities-schema";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
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

export async function DELETE(_: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const [entity] = await getDb().delete(entities).where(eq(entities.id, Number(id))).returning();
  if (!entity) {
    return Response.json({ error: { code: "NOT_FOUND", message: "实体不存在" } }, { status: 404 });
  }
  return Response.json(entity);
}
