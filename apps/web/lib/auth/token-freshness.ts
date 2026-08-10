/**
 * T-SEC-06 / S3a: 服务端 JWT 新鲜度校验。
 *
 * JWT 是无状态的，role/disabled 只在登录时写入；禁用/降权/改密码后旧 token 在 maxAge(2h)
 * 内仍有效。本模块对需要即时撤权的路径查 DB 当前 disabled_at + role + token_version，
 * 与 token 内值比对，不符即视为失效。
 *
 * 查询走 users.id 主键（eq + limit 1），不做全表扫描。
 *
 * - API：`requireFreshViewer`（viewer 级，Node route handler）
 * - Admin RSC：`gateAdminPage`（admin 级，layout 用）
 * - 底层：`verifyTokenFreshness`（亦被 `lib/api/authz.requireFreshRole` 调用）
 */
import { eq } from "drizzle-orm";
import { getDb, users } from "@fe-radar/db";

import type { UserRole } from "@fe-radar/shared";
import type { NextRequest } from "next/server";

export interface TokenClaims {
  sub?: string;
  role?: string;
  tokenVersion?: number;
}

export interface FreshnessResult {
  valid: boolean;
  reason?: string;
}

export type AdminPageGateResult =
  | { ok: true }
  | { ok: false; kind: "unauthenticated" | "forbidden" | "revoked"; reason?: string };

/**
 * 校验 token 的 sub 用户当前状态与 token 内 role/tokenVersion 是否一致。
 * - 用户不存在 / 已禁用 → 失效。
 * - 当前 DB role 与 token.role 不一致 → 失效（降权后旧 token）。
 * - 当前 DB token_version 与 token.tokenVersion 不一致 → 失效（撤权递增后旧 token）。
 * - **S3b fail-closed**：token 缺少 `tokenVersion` claim → 失效（覆盖升级前存量 JWT + 内免登漏写路径）。
 *   发布后会强制全员重新登录一次；不再给「缺 claim 仅比角色」的永久放行窗口。
 *
 * 查库：`SELECT ... FROM users WHERE id = $1 LIMIT 1`（主键）。
 */
export async function verifyTokenFreshness(claims: TokenClaims): Promise<FreshnessResult> {
  if (!claims.sub) {
    return { valid: false, reason: "NO_SUBJECT" };
  }
  const userId = Number(claims.sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { valid: false, reason: "INVALID_SUBJECT" };
  }

  let row: { disabledAt: Date | null; role: string; tokenVersion: number } | undefined;
  try {
    const rows = await getDb()
      .select({ disabledAt: users.disabledAt, role: users.role, tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    row = rows[0];
  } catch {
    // 复核 F8: DB 不可达时 fail-closed —— 宁可短暂拒绝，也不让被撤权的旧 token 在抖动窗口内继续生效。
    return { valid: false, reason: "DB_UNREACHABLE_FAIL_CLOSED" };
  }

  if (!row) {
    return { valid: false, reason: "USER_DELETED" };
  }
  if (row.disabledAt != null) {
    return { valid: false, reason: "USER_DISABLED" };
  }
  if (claims.role && row.role !== claims.role) {
    return { valid: false, reason: "ROLE_CHANGED" };
  }
  // S3b: 缺 tokenVersion claim = stale（旧 fail-open 会永久绕过撤权，尤其钉钉内免登）。
  if (typeof claims.tokenVersion !== "number") {
    return { valid: false, reason: "TOKEN_VERSION_MISSING" };
  }
  if (row.tokenVersion !== claims.tokenVersion) {
    return { valid: false, reason: "TOKEN_VERSION_STALE" };
  }
  return { valid: true };
}

function sessionRevokedResponse(): Response {
  return Response.json(
    { error: { code: "SESSION_REVOKED", message: "会话已失效，请重新登录" } },
    { status: 401 }
  );
}

/**
 * Viewer 级 API 新鲜度闸门（S3a / S3b）。
 *
 * 语义对齐 `requireFreshRole(request, "viewer")`，但：
 * 1. 无会话 claims 时返回 null（未登录由 middleware / 路由自身处理，避免破坏仅 mock 业务层的单测）。
 * 2. 有会话时一律查库核对 disabled_at / role / tokenVersion（与 `gateAdminPage` 一致）。
 * 3. **S3b**：缺 `tokenVersion` 不再早返回跳过查库——传 `undefined` 给 `verifyTokenFreshness`，
 *    由统一裁决 fail-closed（TOKEN_VERSION_MISSING）。
 *
 * 生产路径：登录写入 tokenVersion → 每次带会话的只读/反馈请求都查主键。
 */
export async function requireFreshViewer(request: NextRequest): Promise<Response | null> {
  // 只依赖 getRequestUser：许多 route 单测 partial-mock authz 时未导出 forbidden/unauthorized。
  const { getRequestUser } = await import("@/lib/api/authz");
  const { hasRole } = await import("@/lib/auth/rbac");

  const user = await getRequestUser(request);

  // 无会话：不在此拦截（middleware 负责；部分 route 单测直接调 handler）。
  // 经核实安全：middleware matcher 已覆盖全部相关 route；勿改为强制 401，会破坏现有单测。
  if (user.id === undefined && user.role === undefined) {
    return null;
  }

  if (!user.role) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
  }
  if (!hasRole(user.role, "viewer")) {
    return Response.json({ error: { code: "FORBIDDEN", message: "权限不足" } }, { status: 403 });
  }

  // 与 gateAdminPage 一致：缺 claim 传 undefined，由 verifyTokenFreshness 统一 fail-closed。
  const freshness = await verifyTokenFreshness({
    sub: user.id !== undefined ? String(user.id) : undefined,
    role: user.role,
    tokenVersion: typeof user.tokenVersion === "number" ? user.tokenVersion : undefined
  });

  if (!freshness.valid) {
    return sessionRevokedResponse();
  }
  return null;
}

function normalizeRole(role: unknown): UserRole | undefined {
  return role === "admin" || role === "editor" || role === "viewer" ? role : undefined;
}

/**
 * Admin Server Component / layout 闸门（S3a 缺陷 A / A-5）。
 * 从 cookie 解 JWT（含 tokenVersion），按路径要求 admin 或 editor，并查库校验新鲜度。
 * 角色映射唯一权威：`requiredAdminPageRole`（middleware.ts），经 `x-pathname` 对齐。
 * 必须在 Node runtime 调用（查库）；不要放进 Edge middleware。
 *
 * @param pathname 可选；缺省读 middleware 注入的 `x-pathname`（layout 可不传）。
 */
export async function gateAdminPage(pathname?: string): Promise<AdminPageGateResult> {
  const { cookies, headers } = await import("next/headers");
  const { getToken } = await import("next-auth/jwt");
  const { hasRole } = await import("@/lib/auth/rbac");
  // 与 middleware 共用权威定义，禁止在 layout/本函数再写一份路径清单。
  const { requiredAdminPageRole } = await import("../../middleware");

  const path =
    pathname ??
    (await headers()).get("x-pathname") ??
    "/admin";
  const requiredRole = requiredAdminPageRole(path);

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  let token: {
    sub?: string;
    role?: unknown;
    tokenVersion?: unknown;
  } | null;
  try {
    token = await getToken({
      req: { headers: { cookie: cookieHeader } },
      cookieName: "fe-radar.session-token",
      secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
    });
  } catch {
    return { ok: false, kind: "unauthenticated", reason: "TOKEN_READ_FAILED" };
  }

  if (!token?.sub) {
    return { ok: false, kind: "unauthenticated" };
  }

  const role = normalizeRole(token.role);
  if (!hasRole(role, requiredRole)) {
    return { ok: false, kind: "forbidden" };
  }

  const freshness = await verifyTokenFreshness({
    sub: token.sub,
    role,
    tokenVersion: typeof token.tokenVersion === "number" ? token.tokenVersion : undefined
  });

  if (!freshness.valid) {
    // 停用 / 撤权 → 引导重新登录；角色不足用 forbidden 已覆盖。
    if (freshness.reason === "ROLE_CHANGED") {
      return { ok: false, kind: "forbidden", reason: freshness.reason };
    }
    return { ok: false, kind: "revoked", reason: freshness.reason };
  }

  return { ok: true };
}
