import { desc } from "drizzle-orm";
import { entities, getDb } from "@fe-radar/db";
import { entityBodySchema, validationError } from "@/lib/api/entities-schema";

export async function GET(): Promise<Response> {
  const rows = await getDb().select().from(entities).orderBy(desc(entities.id));
  return Response.json({ items: rows });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = entityBodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return validationError(parsed.error.flatten());
  }
  const [entity] = await getDb().insert(entities).values(parsed.data).returning();
  return Response.json(entity, { status: 201 });
}
