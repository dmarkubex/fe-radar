import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoist mock functions so vi.mock factories can reference them
const {
  mockGetRequestUser,
  mockRequireFreshRole,
  selectWhere,
  mockSelect,
  updateReturning,
  mockUpdate,
  insertValues,
  mockInsert,
} = vi.hoisted(() => {
  const selectWhere = vi.fn();
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const mockSelect = vi.fn(() => ({ from: selectFrom }));

  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const mockUpdate = vi.fn(() => ({ set: updateSet }));

  const insertValues = vi.fn();
  const mockInsert = vi.fn(() => ({ values: insertValues }));

  return {
    mockGetRequestUser: vi.fn<(req: unknown) => Promise<{ id?: number; role?: string; name?: string | null }>>(),
    mockRequireFreshRole: vi.fn<(req: unknown, role: string) => Promise<Response | null>>(),
    selectWhere,
    selectFrom,
    mockSelect,
    updateReturning,
    updateWhere,
    updateSet,
    mockUpdate,
    insertValues,
    mockInsert,
  };
});

// --- Mocks (must precede route import) ---

vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => conds,
  count: () => Symbol("count"),
  eq: (col: unknown, val: unknown) => ({ col, val, op: "eq" }),
  isNull: (col: unknown) => ({ col, op: "isNull" }),
  ne: (col: unknown, val: unknown) => ({ col, val, op: "ne" }),
  // T-SEC-06: route now increments token_version via sql`<col> + 1`.
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    $sql: strings.join("?"),
    $values: values,
  }),
}));

vi.mock("@/lib/api/authz", () => ({
  getRequestUser: mockGetRequestUser,
  requireFreshRole: mockRequireFreshRole,
}));

vi.mock("@/lib/api/users-schema", async () => {
  const { z } = await import("zod");
  return {
    updateUserSchema: z.object({
      role: z.enum(["viewer", "editor", "admin"]).optional(),
      disabled: z.boolean().optional(),
    }),
    mergeConflictActionSchema: z.object({ action: z.enum(["confirm", "reject"]) }),
    validationError: (details: unknown) =>
      Response.json(
        { error: { code: "VALIDATION", message: "参数校验失败", details } },
        { status: 400 },
      ),
  };
});

vi.mock("@fe-radar/db", () => ({
  getDb: () => ({
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
  }),
  users: { id: "id", role: "role", disabledAt: "disabledAt", tokenVersion: "tokenVersion", createdAt: "createdAt", username: "username", dingtalkId: "dingtalkId", name: "name", dept: "dept" },
  auditLogs: {},
  mergeConflicts: {},
}));

// Import route AFTER mocks
import { PUT } from "../[id]/route";

// --- Helpers ---

function makeRequest(body: Record<string, unknown>): unknown {
  return { json: () => Promise.resolve(body) };
}

function makeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function putUser(
  targetId: number,
  body: Record<string, unknown>,
  actor: { id?: number; role?: string; name?: string },
): Promise<Response> {
  mockGetRequestUser.mockResolvedValue(actor);
  const res = await PUT(makeRequest(body) as never, makeContext(String(targetId)));
  return res as Response;
}

/** Configure select().from().where() to return sequentially */
function givenSelectWhere(...results: unknown[][]) {
  selectWhere.mockReset();
  for (const r of results) {
    selectWhere.mockResolvedValueOnce(r);
  }
}

/** Configure update().set().where().returning() */
function givenUpdateReturning(result: Record<string, unknown> | null) {
  updateReturning.mockReset();
  updateReturning.mockResolvedValue(result ? [result] : []);
}

// --- Tests ---

describe("PUT /api/users/[id] — admin protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertValues.mockResolvedValue(undefined);
    mockRequireFreshRole.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------ self-demotion
  it("blocks admin from demoting themselves", async () => {
    const res = await putUser(1, { role: "editor" }, { id: 1, role: "admin" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  // ------------------------------------------------------------------ self-disable
  it("blocks admin from disabling themselves", async () => {
    const res = await putUser(1, { disabled: true }, { id: 1, role: "admin" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toContain("停用");
  });

  it("allows admin to re-enable themselves", async () => {
    givenUpdateReturning({ id: 1, role: "admin", disabledAt: null });
    const res = await putUser(1, { disabled: false }, { id: 1, role: "admin" });
    expect(res.status).toBe(200);
  });

  // ---------------------------------------------------------- disable last active admin
  it("blocks disabling the last active admin", async () => {
    givenSelectWhere([{ total: 0 }]);
    const res = await putUser(2, { disabled: true }, { id: 1, role: "admin" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toContain("活跃 admin");
  });

  it("allows disabling an admin when other active admins exist", async () => {
    givenSelectWhere([{ total: 1 }]);
    givenUpdateReturning({ id: 2, role: "admin", disabledAt: new Date().toISOString() });
    const res = await putUser(2, { disabled: true }, { id: 1, role: "admin" });
    expect(res.status).toBe(200);
  });

  // -------------------------------------------- historical disabled admins don't count
  it("blocks disable when other admins are only historically disabled", async () => {
    givenSelectWhere([{ total: 0 }]);
    const res = await putUser(3, { disabled: true }, { id: 1, role: "admin" });
    expect(res.status).toBe(403);
    // Assert the query includes isNull(disabledAt) — the core fix
    const whereConditions = selectWhere.mock.calls[0]?.[0] as unknown[];
    expect(whereConditions).toEqual(
      expect.arrayContaining([expect.objectContaining({ op: "isNull" })]),
    );
  });

  // ------------------------------------------------- downgrade last active admin role
  it("blocks role downgrade of the last active admin", async () => {
    // First selectWhere: fetch target role → admin
    // Second selectWhere: count active admins excluding target → 0
    givenSelectWhere([{ role: "admin" }], [{ total: 0 }]);
    const res = await putUser(2, { role: "editor" }, { id: 1, role: "admin" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toContain("活跃 admin");
    // Assert the count query includes isNull(disabledAt) for the downgrade path too
    const countConditions = selectWhere.mock.calls[1]?.[0] as unknown[];
    expect(countConditions).toEqual(
      expect.arrayContaining([expect.objectContaining({ op: "isNull" })]),
    );
  });

  it("allows role downgrade when other active admins exist", async () => {
    givenSelectWhere([{ role: "admin" }], [{ total: 1 }]);
    givenUpdateReturning({ id: 2, role: "editor", disabledAt: null });
    const res = await putUser(2, { role: "editor" }, { id: 1, role: "admin" });
    expect(res.status).toBe(200);
  });

  // --------------------------------------------------- non-admin role change is fine
  it("skips admin guard when downgrading a non-admin", async () => {
    givenSelectWhere([{ role: "editor" }]);
    givenUpdateReturning({ id: 2, role: "viewer", disabledAt: null });
    const res = await putUser(2, { role: "viewer" }, { id: 1, role: "admin" });
    expect(res.status).toBe(200);
  });

  // ---------------------------------------------------------- disable non-admin user
  it("allows disabling a non-admin when only one active admin exists", async () => {
    givenSelectWhere([{ total: 1 }]);
    givenUpdateReturning({ id: 3, role: "viewer", disabledAt: new Date().toISOString() });
    const res = await putUser(3, { disabled: true }, { id: 1, role: "admin" });
    expect(res.status).toBe(200);
  });

  // --------------------------------------------------- combined disable + role change
  it("blocks combined disable + role downgrade of last active admin", async () => {
    givenSelectWhere([{ total: 0 }]);
    const res = await putUser(2, { disabled: true, role: "editor" }, { id: 1, role: "admin" });
    expect(res.status).toBe(403);
  });
});
