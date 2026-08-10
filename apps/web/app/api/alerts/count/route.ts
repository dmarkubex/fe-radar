import { fetchAlertCount } from "@/lib/api/alerts-query";
import { requireFreshViewer } from "@/lib/auth/token-freshness";

import type { NextRequest } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  const freshError = await requireFreshViewer(request);
  if (freshError) return freshError;

  return Response.json(await fetchAlertCount());
}
