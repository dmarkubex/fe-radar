import { fetchDashboardData } from "@/lib/api/dashboard-query";
import { requireFreshRole } from "@/lib/api/authz";

import type { NextRequest } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "admin");
  if (authError) return authError;
  return Response.json(await fetchDashboardData());
}
