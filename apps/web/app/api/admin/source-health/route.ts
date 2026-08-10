import { fetchSourceHealth } from "@/lib/api/source-health-query";
import { requireFreshRole } from "@/lib/api/authz";

import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "editor");
  if (authError) return authError;
  return Response.json(await fetchSourceHealth());
}
