import { canIncludeBlocked, getRequestUser } from "@/lib/api/authz";
import { fetchTimeline } from "@/lib/api/timeline-query";
import { searchQuerySchema } from "@/lib/api/timeline-schema";

import type { NextRequest } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl;
  const user = await getRequestUser(request);
  const parsed = searchQuerySchema.safeParse({
    q: searchParams.get("q") ?? "",
    cursor: searchParams.get("cursor") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    circle: searchParams.get("circle") ?? undefined,
    tier: searchParams.get("tier") ?? undefined,
    eventType: searchParams.get("event_type") ?? searchParams.get("eventType") ?? undefined,
    alertType: searchParams.get("alert_type") ?? searchParams.get("alertType") ?? undefined,
    includeBlocked: searchParams.get("includeBlocked") ?? undefined
  });

  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "参数错误", details: parsed.error.flatten() } }, { status: 400 });
  }

  const data = await fetchTimeline({
    filters: parsed.data,
    includeBlocked: canIncludeBlocked(user.role, parsed.data.includeBlocked),
    cursor: parsed.data.cursor,
    limit: parsed.data.limit,
    search: parsed.data.q
  });

  return Response.json(data);
}
