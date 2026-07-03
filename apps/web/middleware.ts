import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { hasRole } from "@/lib/auth/rbac";

import type { NextRequest } from "next/server";

export default async function middleware(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;

  const isAdminPath =
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/api/dashboard") ||
    pathname.startsWith("/api/scoring-config") ||
    pathname.startsWith("/api/users") ||
    pathname.startsWith("/api/briefing/targets") ||
    pathname.startsWith("/admin");
  const isAdminPage = pathname.startsWith("/admin");
  const isEditorPath = pathname.startsWith("/api/sources") || pathname.startsWith("/api/entities");
  const isTimelinePage =
    pathname === "/" ||
    pathname.startsWith("/curated") ||
    pathname.startsWith("/search") ||
    pathname.startsWith("/alerts") ||
    pathname.startsWith("/daily") ||
    pathname.startsWith("/items") ||
    pathname.startsWith("/briefing");
  const isTimelineApi =
    pathname.startsWith("/api/timeline") ||
    pathname.startsWith("/api/search") ||
    pathname.startsWith("/api/items") ||
    pathname.startsWith("/api/alerts") ||
    pathname.startsWith("/api/daily") ||
    pathname.startsWith("/api/alerts/count") ||
    pathname.startsWith("/api/briefing") ||
    pathname.startsWith("/api/quotes");

  if (isAdminPath || isEditorPath || isTimelinePage || isTimelineApi) {
    const token = await getToken({
      req: request,
      cookieName: "fe-radar.session-token",
      secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
    });

    if (!token && (isAdminPage || isTimelinePage)) {
      const loginUrl = new URL("/auth/login", request.url);
      loginUrl.searchParams.set("callbackUrl", request.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }

    if (!token) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
    }

    const role = token.role;
    const requiredRole = isAdminPath ? "admin" : isEditorPath ? "editor" : "viewer";
    if (!hasRole(role === "admin" || role === "editor" || role === "viewer" ? role : undefined, requiredRole)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "权限不足" } }, { status: 403 });
    }
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
    "/briefing/:path*"
  ]
};
