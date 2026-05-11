import { getToken } from "next-auth/jwt";
import { hasRole } from "@/lib/auth/rbac";

import type { UserRole } from "@fe-radar/shared";
import type { NextRequest } from "next/server";

export async function getRequestUser(request: NextRequest): Promise<{ id?: number; role?: UserRole; name?: string | null }> {
  const token = await getToken({
    req: request,
    cookieName: "fe-radar.session-token",
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  });

  const role = token?.role;
  return {
    id: token?.sub ? Number(token.sub) : undefined,
    role: role === "admin" || role === "editor" || role === "viewer" ? role : undefined,
    name: token?.name
  };
}

export function canIncludeBlocked(role: UserRole | undefined, includeBlocked: boolean): boolean {
  return includeBlocked && hasRole(role, "admin");
}

export function unauthorized(): Response {
  return Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
}

export function forbidden(): Response {
  return Response.json({ error: { code: "FORBIDDEN", message: "权限不足" } }, { status: 403 });
}

export function notFound(): Response {
  return Response.json({ error: { code: "NOT_FOUND", message: "条目不存在或不可访问" } }, { status: 404 });
}
