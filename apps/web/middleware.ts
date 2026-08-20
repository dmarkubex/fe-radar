import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { hasRole } from "@/lib/auth/rbac";
import {
  buildSafeCallbackUrl,
  isDingTalkUserAgent
} from "@/lib/auth/safe-callback-url";
// 复核 CRIT-1: middleware 跑在 Edge runtime，不能 import @fe-radar/db（postgres.js → node:net）。
// token 新鲜度校验（verifyTokenFreshness）改在特权 route handler 里做（Node runtime），
// 见 apps/web/lib/api/authz.ts 的 requireFreshRole。

import type { NextRequest } from "next/server";
import type { UserRole } from "@fe-radar/shared";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function httpOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * A-5 权威定义：admin **页面**路径 → 最低角色。
 * middleware 与 `(admin)/layout` → `gateAdminPage` 必须共用本函数，禁止第二份清单。
 * （仅对 `/admin/**` 有意义；API 角色仍由下方 isEditorPath / isAdminPath 决定。）
 */
export const EDITOR_ADMIN_PAGE_PREFIXES = ["/admin/entities", "/admin/sources"] as const;

export function requiredAdminPageRole(pathname: string): Extract<UserRole, "admin" | "editor"> {
  const isEditorAdminPage = EDITOR_ADMIN_PAGE_PREFIXES.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
  return isEditorAdminPage ? "editor" : "admin";
}

export default async function middleware(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;

  // /auth/** must never auth-redirect (prevents DingTalk auto-login loops).
  // Matcher still includes auth paths so x-pathname can be injected for layouts.
  const isAuthPath = pathname === "/auth" || pathname.startsWith("/auth/");

  const isAdminPath =
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/api/dashboard") ||
    pathname.startsWith("/api/scoring-config") ||
    pathname.startsWith("/api/users") ||
    pathname.startsWith("/api/briefing/targets") ||
    pathname.startsWith("/admin");
  const isAdminPage = pathname.startsWith("/admin");
  const isEditorPath =
    pathname === "/api/admin/source-health" ||
    pathname.startsWith("/api/sources") ||
    pathname.startsWith("/api/entities");
  const isTimelinePage =
    pathname === "/" ||
    pathname.startsWith("/curated") ||
    pathname.startsWith("/search") ||
    pathname.startsWith("/alerts") ||
    pathname.startsWith("/daily") ||
    pathname.startsWith("/items") ||
    pathname.startsWith("/briefing") ||
    pathname === "/ask" ||
    pathname.startsWith("/ask/");
  const isTimelineApi =
    pathname.startsWith("/api/timeline") ||
    pathname.startsWith("/api/search") ||
    pathname.startsWith("/api/items") ||
    pathname.startsWith("/api/alerts") ||
    pathname.startsWith("/api/daily") ||
    pathname.startsWith("/api/alerts/count") ||
    pathname.startsWith("/api/briefing") ||
    pathname.startsWith("/api/quotes") ||
    pathname.startsWith("/api/copilot");
  const isProtectedApi =
    pathname.startsWith("/api/") && (isAdminPath || isEditorPath || isTimelineApi);

  if (!isAuthPath && (isAdminPath || isEditorPath || isTimelinePage || isTimelineApi)) {
    if (isProtectedApi && MUTATING_METHODS.has(request.method)) {
      const requestOrigin = httpOrigin(request.headers.get("origin"));
      const configuredAuthUrl = [process.env.AUTH_URL, process.env.NEXTAUTH_URL]
        .find((value) => typeof value === "string" && value.trim() !== "")
        ?.trim();
      const allowedOrigin = configuredAuthUrl
        ? httpOrigin(configuredAuthUrl)
        : request.nextUrl.origin;
      if (!requestOrigin || requestOrigin !== allowedOrigin) {
        return NextResponse.json(
          { error: { code: "FORBIDDEN", message: "跨站请求已拒绝" } },
          { status: 403 }
        );
      }
    }

    const token = await getToken({
      req: request,
      cookieName: "fe-radar.session-token",
      secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
    });

    if (!token && (isAdminPage || isTimelinePage)) {
      const callbackUrl = buildSafeCallbackUrl(pathname, request.nextUrl.search);
      const dingtalkEnabled = process.env.DINGTALK_ENABLED === "true";
      const ua = request.headers.get("user-agent");
      const loginPath =
        dingtalkEnabled && isDingTalkUserAgent(ua) ? "/auth/dingtalk/auto" : "/auth/login";
      const loginUrl = new URL(loginPath, request.url);
      loginUrl.searchParams.set("callbackUrl", callbackUrl);
      return NextResponse.redirect(loginUrl);
    }

    if (!token) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
    }

    const role = token.role;
    // admin 页面角色：与 gateAdminPage 共用 requiredAdminPageRole（单一权威）
    const requiredRole: UserRole = isEditorPath
      ? "editor"
      : isAdminPage
        ? requiredAdminPageRole(pathname)
        : isAdminPath
          ? "admin"
          : "viewer";
    if (!hasRole(role === "admin" || role === "editor" || role === "viewer" ? role : undefined, requiredRole)) {
      if (isAdminPage || isTimelinePage) {
        return new NextResponse(
          "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>403 · 权限不足</title></head><body><div role=\"main\"><h1>403 · 权限不足</h1><p>当前账号无权访问此页面。</p><a href=\"/\">返回首页</a></div></body></html>",
          { status: 403, headers: { "content-type": "text/html; charset=utf-8" } }
        );
      }
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "权限不足" } }, { status: 403 });
    }

    // T-SEC-06 (复核 CRIT-1): token 新鲜度校验从 middleware 移到特权 route handler
    // （requireFreshRole），因为 middleware 跑 Edge runtime 不能查 DB。RBAC 仍在此生效。
  }

  // NextResponse.next({ request }) makes header readable via headers() in RSC; see DMA-51
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    "/",
    "/auth/:path*",
    "/curated/:path*",
    "/search/:path*",
    "/alerts/:path*",
    "/daily/:path*",
    "/items/:path*",
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/dashboard",
    "/api/dashboard/:path*",
    "/api/scoring-config",
    "/api/scoring-config/:path*",
    "/api/users",
    "/api/users/:path*",
    "/api/sources",
    "/api/sources/:path*",
    "/api/entities",
    "/api/entities/:path*",
    "/api/timeline/:path*",
    "/api/search/:path*",
    "/api/items/:path*",
    "/api/alerts/:path*",
    "/api/daily",
    "/api/daily/:path*",
    "/api/alerts/count",
    "/api/briefing/targets",
    "/api/briefing/targets/:path*",
    "/api/briefing",
    "/api/briefing/:path*",
    "/api/quotes/:path*",
    "/briefing",
    "/briefing/:path*",
    "/ask",
    "/api/copilot",
    "/api/copilot/:path*"
  ]
};
