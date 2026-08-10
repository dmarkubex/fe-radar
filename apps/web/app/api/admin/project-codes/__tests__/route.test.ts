import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NextRequest } from "next/server";

const {
  mockRequireFreshRole,
  mockSelect,
  mockInsert,
  mockUpdate,
  insertReturning,
  insertValues,
  updateReturning,
  updateWhere,
  updateSet,
  selectFrom,
  selectOrderBy
} = vi.hoisted(() => {
  const selectOrderBy = vi.fn();
  const selectFrom = vi.fn(() => ({ orderBy: selectOrderBy }));
  const mockSelect = vi.fn(() => ({ from: selectFrom }));

  const insertReturning = vi.fn();
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const mockInsert = vi.fn(() => ({ values: insertValues }));

  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const mockUpdate = vi.fn(() => ({ set: updateSet }));

  return {
    mockRequireFreshRole: vi.fn<(req: NextRequest, role: string) => Promise<Response | null>>(),
    mockSelect,
    mockInsert,
    mockUpdate,
    insertReturning,
    insertValues,
    updateReturning,
    updateWhere,
    updateSet,
    selectFrom,
    selectOrderBy
  };
});

vi.mock("drizzle-orm", () => ({
  desc: (col: unknown) => ({ col, op: "desc" }),
  eq: (col: unknown, val: unknown) => ({ col, val, op: "eq" })
}));

vi.mock("@/lib/api/authz", () => ({
  requireFreshRole: mockRequireFreshRole
}));

vi.mock("@fe-radar/db", () => ({
  getDb: () => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate
  }),
  projectCodes: {
    id: "id",
    code: "code",
    note: "note",
    disabledAt: "disabledAt",
    createdAt: "createdAt"
  }
}));

import { DELETE, GET, PATCH, POST } from "../route";

function makeRequest(
  method: string,
  body?: Record<string, unknown>,
  url = "http://localhost/api/admin/project-codes"
): NextRequest {
  return new Request(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireFreshRole.mockResolvedValue(null);
  selectOrderBy.mockResolvedValue([
    { id: 1, code: "ZX-2026", note: "demo", disabledAt: null, createdAt: "2026-08-01T00:00:00.000Z" }
  ]);
  insertReturning.mockResolvedValue([
    { id: 2, code: "NEW-1", note: null, disabledAt: null, createdAt: "2026-08-10T00:00:00.000Z" }
  ]);
  updateReturning.mockResolvedValue([
    { id: 1, code: "ZX-2026", note: "upd", disabledAt: null, createdAt: "2026-08-01T00:00:00.000Z" }
  ]);
});

describe("GET /api/admin/project-codes", () => {
  it("requires admin fresh role", async () => {
    mockRequireFreshRole.mockResolvedValueOnce(
      Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 })
    );
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(403);
    expect(mockRequireFreshRole).toHaveBeenCalledWith(expect.anything(), "admin");
  });

  it("lists project codes", async () => {
    const res = await GET(makeRequest("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].code).toBe("ZX-2026");
    // select → from(projectCodes) → orderBy(desc(id))
    expect(selectFrom).toHaveBeenCalledWith(
      expect.objectContaining({ id: "id", code: "code" })
    );
    expect(selectOrderBy).toHaveBeenCalledWith({ col: "id", op: "desc" });
  });
});

describe("POST /api/admin/project-codes", () => {
  it("creates a code", async () => {
    const res = await POST(makeRequest("POST", { code: "NEW-1", note: null }));
    expect(res.status).toBe(201);
    expect(insertValues).toHaveBeenCalledWith({ code: "NEW-1", note: null });
    const body = await res.json();
    expect(body.code).toBe("NEW-1");
  });

  it("rejects empty code", async () => {
    const res = await POST(makeRequest("POST", { code: "  " }));
    expect(res.status).toBe(400);
  });

  it("maps unique violation to 409", async () => {
    insertReturning.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));
    const res = await POST(makeRequest("POST", { code: "ZX-2026" }));
    expect(res.status).toBe(409);
  });

  it("requires admin", async () => {
    mockRequireFreshRole.mockResolvedValueOnce(
      Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 })
    );
    const res = await POST(makeRequest("POST", { code: "X" }));
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/admin/project-codes", () => {
  it("updates note and soft-disables via enabled=false", async () => {
    updateReturning.mockResolvedValueOnce([
      { id: 1, code: "ZX-2026", note: "n", disabledAt: "2026-08-10T00:00:00.000Z", createdAt: "2026-08-01T00:00:00.000Z" }
    ]);
    const res = await PATCH(makeRequest("PATCH", { id: 1, note: "n", enabled: false }));
    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ note: "n", disabledAt: expect.any(Date) })
    );
    // where(eq(projectCodes.id, id)) — 确保按 id 定位行，不只断言 set 内容
    expect(updateWhere).toHaveBeenCalledWith({ col: "id", val: 1, op: "eq" });
  });

  it("returns 404 when id missing", async () => {
    updateReturning.mockResolvedValueOnce([]);
    const res = await PATCH(makeRequest("PATCH", { id: 99, note: "x" }));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/admin/project-codes", () => {
  it("soft-deletes by query id", async () => {
    updateReturning.mockResolvedValueOnce([
      { id: 1, code: "ZX-2026", note: null, disabledAt: "2026-08-10T00:00:00.000Z", createdAt: "2026-08-01T00:00:00.000Z" }
    ]);
    const res = await DELETE(makeRequest("DELETE", undefined, "http://localhost/api/admin/project-codes?id=1"));
    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith({ disabledAt: expect.any(Date) });
    // where(eq(projectCodes.id, id)) — 软删必须命中 query id，与 set 断言成对
    expect(updateWhere).toHaveBeenCalledWith({ col: "id", val: 1, op: "eq" });
  });

  it("rejects missing id", async () => {
    const res = await DELETE(makeRequest("DELETE"));
    expect(res.status).toBe(400);
  });
});
