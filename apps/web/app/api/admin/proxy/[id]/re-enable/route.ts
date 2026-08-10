import { reenableProxy } from "@/lib/api/proxy-admin";
import { requireFreshRole } from "@/lib/api/authz";

import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const authError = await requireFreshRole(request, "admin");
  if (authError) return authError;

  const { id } = await context.params;
  if (!reenableProxy(id)) {
    return Response.json({ error: { code: "NOT_FOUND", message: "代理节点不存在或未停用" } }, { status: 404 });
  }
  return Response.json({ ok: true });
}
