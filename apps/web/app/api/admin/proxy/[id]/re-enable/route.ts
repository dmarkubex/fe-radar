import { reenableProxy } from "@/lib/api/proxy-admin";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  if (!reenableProxy(id)) {
    return Response.json({ error: { code: "NOT_FOUND", message: "代理节点不存在或未停用" } }, { status: 404 });
  }
  return Response.json({ ok: true });
}
