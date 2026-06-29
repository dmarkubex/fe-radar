import { getRequestUser, notFound } from "@/lib/api/authz";
import { hasRole } from "@/lib/auth/rbac";
import { createMirofishProjectFromItem, MirofishConfigError } from "@/lib/api/mirofish";
import { fetchItemDetail } from "@/lib/api/timeline-query";
import { webLogger } from "@/lib/logger";

import type { NextRequest } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getRequestUser(request);
  if (!user.role) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
  }
  if (!hasRole(user.role, "editor")) {
    return Response.json({ error: { code: "FORBIDDEN", message: "仅 editor/admin 可创建模拟预测项目" } }, { status: 403 });
  }

  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return notFound();
  }

  const item = await fetchItemDetail(itemId, { includeBlocked: false });
  if (!item) {
    return notFound();
  }

  try {
    const project = await createMirofishProjectFromItem(item);
    return Response.json({ itemId, ...project }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MiroFish 创建项目失败";
    webLogger.warn({ err: error, itemId }, "mirofish project creation failed");
    if (error instanceof MirofishConfigError) {
      return Response.json({ error: { code: "MIROFISH_NOT_CONFIGURED", message } }, { status: 503 });
    }
    return Response.json({ error: { code: "MIROFISH_CREATE_FAILED", message } }, { status: 502 });
  }
}
