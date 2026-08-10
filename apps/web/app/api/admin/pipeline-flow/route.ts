import { fetchPipelineFlow } from "@/lib/api/pipeline-flow-query";
import { requireFreshRole } from "@/lib/api/authz";

import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "admin");
  if (authError) return authError;
  return Response.json(await fetchPipelineFlow());
}
