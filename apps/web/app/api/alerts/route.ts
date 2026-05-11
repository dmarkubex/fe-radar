import { fetchAlerts } from "@/lib/api/alerts-query";
import { alertQuerySchema } from "@/lib/api/alerts-schema";

import type { NextRequest } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl;
  const parsed = alertQuerySchema.safeParse({
    type: searchParams.get("type") ?? undefined,
    level: searchParams.get("level") ?? undefined,
    source: searchParams.get("source") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined,
    limit: searchParams.get("limit") ?? undefined
  });

  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION", message: "参数校验失败", details: parsed.error.flatten() } }, { status: 400 });
  }

  return Response.json(await fetchAlerts(parsed.data));
}
