import { createSource, getDb, listSources } from "@fe-radar/db";
import { createSourceSchema, validationError } from "@/lib/api/sources-schema";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const tier = searchParams.get("tier") ?? undefined;
  const category = searchParams.get("category") ?? undefined;
  const enabledParam = searchParams.get("enabled");
  const enabled = enabledParam === null ? undefined : enabledParam === "true";
  const items = await listSources(getDb(), {
    tier: tier === "T1" || tier === "T2" || tier === "T3" ? tier : undefined,
    category,
    enabled
  });
  return Response.json({ items, nextCursor: null });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = createSourceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return validationError(parsed.error.flatten());
  }

  const source = await createSource(getDb(), parsed.data);
  return Response.json(source, { status: 201 });
}
