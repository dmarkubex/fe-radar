import { canIncludeBlocked, getRequestUser, notFound } from "@/lib/api/authz";
import { requireFreshViewer } from "@/lib/auth/token-freshness";
import { fetchItemDetail } from "@/lib/api/timeline-query";

import type { NextRequest } from "next/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const freshError = await requireFreshViewer(request);
  if (freshError) return freshError;

  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return notFound();
  }

  const user = await getRequestUser(request);
  const includeBlocked = canIncludeBlocked(user.role, request.nextUrl.searchParams.get("includeBlocked") === "true");
  const item = await fetchItemDetail(itemId, { includeBlocked });

  if (!item) {
    return notFound();
  }

  return Response.json({ item });
}
