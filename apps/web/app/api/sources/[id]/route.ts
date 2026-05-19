import { getDb, softDeleteSource, updateSource } from "@fe-radar/db";
import { updateSourceSchema, validationError } from "@/lib/api/sources-schema";
import { isMockMode } from "@/lib/mock-mode";
import { mockSources } from "@/lib/mock-data";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const parsed = updateSourceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return validationError(parsed.error.flatten());
  }

  if (isMockMode()) {
    const source = mockSources.find((item) => item.id === Number(id));
    return source ? Response.json({ ...source, ...parsed.data }) : Response.json({ error: { code: "NOT_FOUND", message: "信源不存在" } }, { status: 404 });
  }

  const source = await updateSource(getDb(), Number(id), parsed.data);
  if (!source) {
    return Response.json({ error: { code: "NOT_FOUND", message: "信源不存在" } }, { status: 404 });
  }
  return Response.json(source);
}

export async function DELETE(_: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  if (isMockMode()) {
    const source = mockSources.find((item) => item.id === Number(id));
    return source ? Response.json({ ...source, enabled: false }) : Response.json({ error: { code: "NOT_FOUND", message: "信源不存在" } }, { status: 404 });
  }
  const source = await softDeleteSource(getDb(), Number(id));
  if (!source) {
    return Response.json({ error: { code: "NOT_FOUND", message: "信源不存在" } }, { status: 404 });
  }
  return Response.json(source);
}
