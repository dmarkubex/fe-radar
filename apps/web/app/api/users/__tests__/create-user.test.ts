import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NextRequest } from "next/server";
import type * as UsersSchemaModule from "@/lib/api/users-schema";

const {
  mockRequireRequestRole,
  mockGetRequestUser,
  mockHashPassword,
  selectWhere,
  mockSelect,
  insertReturning,
  insertValues,
  mockInsert
} = vi.hoisted(() => {
  const selectWhere = vi.fn();
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const mockSelect = vi.fn(() => ({ from: selectFrom }));

  const insertReturning = vi.fn();
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const mockInsert = vi.fn(() => ({ values: insertValues }));

  return {
    mockRequireRequestRole: vi.fn<(req: NextRequest, role: string) => Promise<Response | null>>(),
    mockGetRequestUser: vi.fn<(req: NextRequest) => Promise<{ id?: number; role?: string; name?: string | null }>>(),
    mockHashPassword: vi.fn<(password: string) => Promise<string>>(),
    selectWhere,
    mockSelect,
    insertReturning,
    insertValues,
    mockInsert
  };
});

vi.mock("drizzle-orm", () => ({
  desc: (col: unknown) => ({ col, op: "desc" }),
  eq: (col: unknown, val: unknown) => ({ col, val, op: "eq" })
}));

vi.mock("@/lib/api/authz", () => ({
  requireRequestRole: mockRequireRequestRole,
  getRequestUser: mockGetRequestUser
}));

vi.mock("@/lib/auth/password", () => ({
  hashPassword: mockHashPassword
}));

vi.mock("@/lib/api/users-schema", async () => {
  const actual = await vi.importActual<typeof UsersSchemaModule>("@/lib/api/users-schema");
  return actual;
});

vi.mock("@fe-radar/db", () => ({
  getDb: () => ({
    select: mockSelect,
    insert: mockInsert
  }),
  users: {
    id: "id",
    username: "username",
    dingtalkId: "dingtalkId",
    name: "name",
    dept: "dept",
    role: "role",
    disabledAt: "disabledAt",
    createdAt: "createdAt"
  },
  auditLogs: {},
  mergeConflicts: {}
}));

import { POST } from "../route";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request("http://localhost/api/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireRequestRole.mockResolvedValue(null);
  mockGetRequestUser.mockResolvedValue({ id: 1, role: "admin", name: "Admin" });
  mockHashPassword.mockResolvedValue("hashed-password");
  selectWhere.mockResolvedValue([]);
  insertReturning.mockResolvedValue([{
    id: 2,
    username: "jdoe",
    name: "张三",
    dept: null,
    role: "viewer",
    createdAt: "2026-06-26T00:00:00.000Z"
  }]);
});

describe("POST /api/users", () => {
  it("creates a local user without returning passwordHash", async () => {
    const response = await POST(makeRequest({
      username: "jdoe",
      password: "password123",
      name: "张三",
      role: "viewer"
    }));

    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ username: "jdoe", name: "张三", role: "viewer" });
    expect(body).not.toHaveProperty("passwordHash");
    expect(mockRequireRequestRole).toHaveBeenCalledWith(expect.anything(), "admin");
    expect(mockHashPassword).toHaveBeenCalledWith("password123");
    expect(insertValues).toHaveBeenNthCalledWith(1, expect.objectContaining({ passwordHash: "hashed-password" }));
    expect(insertValues).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: "create_user",
      actorUserId: 1,
      targetUserId: 2,
      meta: { username: "jdoe", role: "viewer" }
    }));
  });

  it("returns 409 when username already exists", async () => {
    selectWhere.mockResolvedValueOnce([{ id: 2 }]);

    const response = await POST(makeRequest({
      username: "jdoe",
      password: "password123",
      name: "张三"
    }));

    expect(response.status).toBe(409);
    const body = await response.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("USERNAME_TAKEN");
    expect(mockHashPassword).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns auth errors for non-admin users", async () => {
    mockRequireRequestRole.mockResolvedValueOnce(
      Response.json({ error: { code: "FORBIDDEN", message: "权限不足" } }, { status: 403 })
    );

    const response = await POST(makeRequest({
      username: "jdoe",
      password: "password123",
      name: "张三"
    }));

    expect(response.status).toBe(403);
    expect(mockGetRequestUser).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("returns validation errors for invalid input", async () => {
    const response = await POST(makeRequest({
      username: "jd",
      password: "password123",
      name: "张三"
    }));

    expect(response.status).toBe(400);
    const body = await response.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("VALIDATION");
    expect(mockHashPassword).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
