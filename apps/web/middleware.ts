import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasRole } from "@/lib/auth/rbac";

export default auth((request) => {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/api/admin") || pathname.startsWith("/admin")) {
    if (!request.auth?.user) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
    }

    if (!hasRole(request.auth.user.role, "admin")) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "权限不足" } }, { status: 403 });
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"]
};
