import { fetchWorkerMonitor } from "@/lib/api/worker-monitor-query";
import { requireFreshRole } from "@/lib/api/authz";

import type { NextRequest } from "next/server";

// 实时队列状态，禁止静态化 / 缓存。
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "admin");
  if (authError) return authError;
  return Response.json(await fetchWorkerMonitor());
}
