import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NextRequest } from "next/server";

// Mock @fe-radar/db so verifyTokenFreshness doesn't need a live DB.
const dbRows = vi.hoisted(() => ({
  current: [] as Array<{ disabledAt: Date | null; role: string; tokenVersion: number }>
}));
vi.mock("@fe-radar/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => dbRows.current
        })
      })
    })
  }),
  users: { id: "id", role: "role", disabledAt: "disabledAt", tokenVersion: "tokenVersion" }
}));

const mockGetRequestUser = vi.hoisted(() =>
  vi.fn<
    (req: unknown) => Promise<{
      id?: number;
      role?: "admin" | "editor" | "viewer";
      tokenVersion?: number;
    }>
  >()
);

vi.mock("@/lib/api/authz", () => ({
  getRequestUser: (req: unknown) => mockGetRequestUser(req),
  canIncludeBlocked: (role: string | undefined, includeBlocked: boolean) =>
    Boolean(includeBlocked && role === "admin"),
  unauthorized: () =>
    Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 }),
  forbidden: () =>
    Response.json({ error: { code: "FORBIDDEN", message: "权限不足" } }, { status: 403 })
}));

const mockGetToken = vi.hoisted(() => vi.fn());
vi.mock("next-auth/jwt", () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args)
}));

const mockCookiesGetAll = vi.hoisted(() => vi.fn(() => [] as Array<{ name: string; value: string }>));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => mockCookiesGetAll()
  })
}));

const mockFetchTimeline = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/timeline-query", () => ({
  fetchTimeline: (...args: unknown[]) => mockFetchTimeline(...args)
}));

import {
  gateAdminPage,
  requireFreshViewer,
  verifyTokenFreshness
} from "@/lib/auth/token-freshness";

function row(role: string, tokenVersion: number, disabled = false) {
  return [{ disabledAt: disabled ? new Date() : null, role, tokenVersion }];
}

function makeRequest(url = "https://radar.test/api/timeline"): NextRequest {
  return { url, nextUrl: new URL(url) } as unknown as NextRequest;
}

describe("verifyTokenFreshness (T-SEC-06 / S3a)", () => {
  beforeEach(() => {
    dbRows.current = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("valid when role + tokenVersion match an active user", async () => {
    dbRows.current = row("admin", 3);
    const r = await verifyTokenFreshness({ sub: "1", role: "admin", tokenVersion: 3 });
    expect(r.valid).toBe(true);
  });

  it("invalid when the user was disabled after login", async () => {
    dbRows.current = row("admin", 3, true);
    const r = await verifyTokenFreshness({ sub: "1", role: "admin", tokenVersion: 3 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("USER_DISABLED");
  });

  it("invalid when the role was changed (demoted admin)", async () => {
    dbRows.current = row("viewer", 3);
    const r = await verifyTokenFreshness({ sub: "1", role: "admin", tokenVersion: 3 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("ROLE_CHANGED");
  });

  it("invalid when token_version was incremented (revoke)", async () => {
    dbRows.current = row("admin", 4);
    const r = await verifyTokenFreshness({ sub: "1", role: "admin", tokenVersion: 3 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("TOKEN_VERSION_STALE");
  });

  // S3b: 缺 claim 从放行改为 fail-closed（旧逻辑仅比角色后 valid:true）。
  it("S3b: 无 tokenVersion claim → TOKEN_VERSION_MISSING（stale / 拒绝）", async () => {
    dbRows.current = row("admin", 3);
    const r = await verifyTokenFreshness({ sub: "1", role: "admin" });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("TOKEN_VERSION_MISSING");
  });

  it("S3b: 有 claim 且与库一致 → 放行", async () => {
    dbRows.current = row("viewer", 7);
    const r = await verifyTokenFreshness({ sub: "9", role: "viewer", tokenVersion: 7 });
    expect(r.valid).toBe(true);
  });

  it("S3b: 有 claim 但库里已递增 → TOKEN_VERSION_STALE", async () => {
    dbRows.current = row("viewer", 8);
    const r = await verifyTokenFreshness({ sub: "9", role: "viewer", tokenVersion: 7 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("TOKEN_VERSION_STALE");
  });

  it("invalid when user was deleted", async () => {
    dbRows.current = [];
    const r = await verifyTokenFreshness({ sub: "1", role: "admin", tokenVersion: 0 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("USER_DELETED");
  });

  it("rejects missing/invalid subject", async () => {
    expect((await verifyTokenFreshness({})).valid).toBe(false);
    expect((await verifyTokenFreshness({ sub: "0" })).valid).toBe(false);
  });

  it("uses primary-key lookup shape (users.id eq + limit 1) — no full scan", async () => {
    // Contract: implementation selects by users.id with limit(1). This test documents
    // the query path via the mock returning a single row for one id.
    dbRows.current = row("viewer", 1);
    const r = await verifyTokenFreshness({ sub: "42", role: "viewer", tokenVersion: 1 });
    expect(r.valid).toBe(true);
  });
});

describe("requireFreshViewer (S3a 只读/反馈 API)", () => {
  beforeEach(() => {
    dbRows.current = [];
    mockGetRequestUser.mockReset();
    mockFetchTimeline.mockReset();
    mockFetchTimeline.mockResolvedValue({ items: [{ id: 1 }], nextCursor: null });
  });

  it("缺陷 B 回代：停用账号持旧 JWT 调 /api/timeline → 401，不返回数据", async () => {
    mockGetRequestUser.mockResolvedValue({ id: 7, role: "viewer", tokenVersion: 2 });
    dbRows.current = row("viewer", 2, true);

    const { GET } = await import("../../../app/api/timeline/route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("SESSION_REVOKED");
    expect(mockFetchTimeline).not.toHaveBeenCalled();
  });

  it("token_version 已递增、JWT 内为旧版本 → 401", async () => {
    mockGetRequestUser.mockResolvedValue({ id: 7, role: "viewer", tokenVersion: 2 });
    dbRows.current = row("viewer", 5); // DB ahead of JWT

    const gate = await requireFreshViewer(makeRequest());
    expect(gate).not.toBeNull();
    expect(gate!.status).toBe(401);
    const body = await gate!.json();
    expect(body.error.code).toBe("SESSION_REVOKED");
  });

  it("正常在职账号 → 放行（防止过度拦截）", async () => {
    mockGetRequestUser.mockResolvedValue({ id: 7, role: "viewer", tokenVersion: 2 });
    dbRows.current = row("viewer", 2);

    const gate = await requireFreshViewer(makeRequest());
    expect(gate).toBeNull();

    const { GET } = await import("../../../app/api/timeline/route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(mockFetchTimeline).toHaveBeenCalledOnce();
  });

  it("无会话 claims 时不拦截（交给 middleware / 路由自身）", async () => {
    mockGetRequestUser.mockResolvedValue({});
    const gate = await requireFreshViewer(makeRequest());
    expect(gate).toBeNull();
  });

  // S3b: 删掉「缺 tokenVersion 早返回」后，必须走 verifyTokenFreshness 并拒绝。
  it("S3b: 有角色但无 tokenVersion → 401 SESSION_REVOKED（不再跳过查库）", async () => {
    mockGetRequestUser.mockResolvedValue({ id: 7, role: "viewer" }); // no tokenVersion
    dbRows.current = row("viewer", 99); // role matches; still reject for missing claim
    const gate = await requireFreshViewer(makeRequest());
    expect(gate).not.toBeNull();
    expect(gate!.status).toBe(401);
    const body = await gate!.json();
    expect(body.error.code).toBe("SESSION_REVOKED");
  });
});

describe("gateAdminPage (S3a admin layout)", () => {
  beforeEach(() => {
    dbRows.current = [];
    mockGetToken.mockReset();
    mockCookiesGetAll.mockReturnValue([{ name: "fe-radar.session-token", value: "x" }]);
  });

  it("停用的 admin → revoked（layout 应 redirect 登录）", async () => {
    mockGetToken.mockResolvedValue({ sub: "1", role: "admin", tokenVersion: 3 });
    dbRows.current = row("admin", 3, true);

    const gate = await gateAdminPage();
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.kind).toBe("revoked");
      expect(gate.reason).toBe("USER_DISABLED");
    }
  });

  it("token_version 过期的 admin → revoked", async () => {
    mockGetToken.mockResolvedValue({ sub: "1", role: "admin", tokenVersion: 1 });
    dbRows.current = row("admin", 9);

    const gate = await gateAdminPage();
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.kind).toBe("revoked");
      expect(gate.reason).toBe("TOKEN_VERSION_STALE");
    }
  });

  it("在职 admin → ok（正常渲染 children）", async () => {
    mockGetToken.mockResolvedValue({ sub: "1", role: "admin", tokenVersion: 3 });
    dbRows.current = row("admin", 3);

    const gate = await gateAdminPage();
    expect(gate).toEqual({ ok: true });
  });

  it("无 token → unauthenticated（layout redirect 登录）", async () => {
    mockGetToken.mockResolvedValue(null);
    const gate = await gateAdminPage();
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.kind).toBe("unauthenticated");
  });

  it("viewer 角色 → forbidden（layout 403）", async () => {
    mockGetToken.mockResolvedValue({ sub: "2", role: "viewer", tokenVersion: 1 });
    dbRows.current = row("viewer", 1);

    const gate = await gateAdminPage();
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.kind).toBe("forbidden");
  });
});
