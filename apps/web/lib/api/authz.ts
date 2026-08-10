import { getToken } from "next-auth/jwt";
import { hasRole } from "@/lib/auth/rbac";

import type { UserRole } from "@fe-radar/shared";
import type { NextRequest } from "next/server";

export async function getRequestUser(request: NextRequest): Promise<{ id?: number; role?: UserRole; name?: string | null; tokenVersion?: number }> {
  const token = await getToken({
    req: request,
    cookieName: "fe-radar.session-token",
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  });

  const role = token?.role;
  return {
    id: token?.sub ? Number(token.sub) : undefined,
    role: role === "admin" || role === "editor" || role === "viewer" ? role : undefined,
    name: token?.name,
    tokenVersion: typeof token?.tokenVersion === "number" ? token.tokenVersion : undefined
  };
}

/**
 * T-SEC-06 (复核 CRIT-1 + HIGH-3): 特权 route handler 在 Node runtime 查 DB 校验 token 新鲜度。
 * middleware 跑 Edge runtime 不能查 DB，所以把校验下放到 route handler。调用方在通过角色检查后
 * 调本函数；token 失效（禁用/降权/改密码后递增 token_version）返回 401 Response，否则 null。
 *
 * 覆盖原本 middleware 漏掉的特权动作路径：briefing repush/regenerate、users、sources 等。
 */
export async function requireFreshRole(request: NextRequest, requiredRole: UserRole): Promise<Response | null> {
  const authError = await requireRequestRole(request, requiredRole);
  if (authError) return authError;
  // 延迟导入避免 Edge 不兼容模块进入非特权路径的打包（route handler 本就在 Node runtime）。
  const { verifyTokenFreshness } = await import("@/lib/auth/token-freshness");
  const user = await getRequestUser(request);
  const freshness = await verifyTokenFreshness({
    sub: user.id !== undefined ? String(user.id) : undefined,
    role: user.role,
    tokenVersion: user.tokenVersion
  });
  if (!freshness.valid) {
    return Response.json({ error: { code: "SESSION_REVOKED", message: "会话已失效，请重新登录" } }, { status: 401 });
  }
  return null;
}

export async function requireRequestRole(request: NextRequest, requiredRole: UserRole): Promise<Response | null> {
  const user = await getRequestUser(request);
  if (!user.role) {
    return unauthorized();
  }
  if (!hasRole(user.role, requiredRole)) {
    return forbidden();
  }
  return null;
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
