import { getRequestUser, requireFreshRole } from "@/lib/api/authz";
import { evaluateCopilotAccess } from "@/lib/api/copilot-access";
import { webLogger } from "@/lib/logger";

import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "viewer");
  if (authError) return authError;

  const user = await getRequestUser(request);
  if (user.id === undefined) {
    return Response.json({ enabled: false });
  }

  try {
    const enabled = await evaluateCopilotAccess(user.id);
    return Response.json({ enabled });
  } catch (err) {
    webLogger.error({ err }, "evaluateCopilotAccess failed");
    return Response.json({ enabled: false });
  }
}
