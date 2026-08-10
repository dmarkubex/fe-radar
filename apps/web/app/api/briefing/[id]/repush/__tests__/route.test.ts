import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockGetRequestUser = vi.fn();
const mockQueueAdd = vi.fn();
const mockConnectionQuit = vi.fn().mockResolvedValue(undefined);

vi.mock("@fe-radar/db", () => ({
  getDb: () => ({
    select: mockSelect,
  }),
  commodityBriefings: {
    id: "id",
    briefingDate: "briefing_date",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
}));

vi.mock("@/lib/api/authz", () => ({
  getRequestUser: (...args: unknown[]) => mockGetRequestUser(...args),
  requireFreshRole: async (...args: unknown[]) => {
    const user = await mockGetRequestUser(...args);
    if (!user.role) {
      return Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
    }
    if (user.role !== "admin") {
      return Response.json({ error: { code: "FORBIDDEN", message: "权限不足" } }, { status: 403 });
    }
    return null;
  },
}));

vi.mock("@/lib/auth/rbac", () => ({
  hasRole: (role: string, required: string) => role === required || role === "admin",
}));

vi.mock("bullmq", () => ({
  Queue: class {
    add = mockQueueAdd;
  },
}));

vi.mock("ioredis", () => ({
  default: class {
    quit = mockConnectionQuit;
  },
}));

import { POST } from "../route";

function chainSelect(result: unknown) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(result);
  const asPromise = Promise.resolve(result);
  chain.then = asPromise.then.bind(asPromise);
  chain.catch = asPromise.catch.bind(asPromise);
  chain.finally = asPromise.finally.bind(asPromise);
  return chain;
}

function setupSelectSequence(results: unknown[]) {
  let i = 0;
  mockSelect.mockImplementation(() => chainSelect(results[i++] ?? []));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQueueAdd.mockResolvedValue({ id: "job-1" });
  mockConnectionQuit.mockResolvedValue(undefined);
  mockGetRequestUser.mockResolvedValue({ role: "admin", id: "u1" });
});

function makeRequest(): Request {
  return new Request("http://localhost/api/briefing/42/repush", {
    method: "POST",
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/briefing/[id]/repush", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetRequestUser.mockResolvedValue({ role: null });
    const res = await POST(makeRequest() as never, ctx("42"));
    expect(res.status).toBe(401);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 403 when not admin", async () => {
    mockGetRequestUser.mockResolvedValue({ role: "viewer" });
    const res = await POST(makeRequest() as never, ctx("42"));
    expect(res.status).toBe(403);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 404 for non-integer id", async () => {
    const res = await POST(makeRequest() as never, ctx("abc"));
    expect(res.status).toBe(404);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 404 when briefing missing", async () => {
    setupSelectSequence([[]]);
    const res = await POST(makeRequest() as never, ctx("42"));
    expect(res.status).toBe(404);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 202 and enqueues briefing-repush with kind/trigger on success", async () => {
    setupSelectSequence([
      [{ id: 42, briefingDate: "2026-08-03" }],
    ]);
    const res = await POST(makeRequest() as never, ctx("42"));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ ok: true, briefingId: 42 });
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    const [name, payload] = mockQueueAdd.mock.calls[0]!;
    expect(name).toBe("repush");
    expect(payload).toEqual({
      kind: "briefing-repush",
      briefingId: 42,
      briefingDate: "2026-08-03",
      trigger: "manual",
    });
    expect(mockConnectionQuit).toHaveBeenCalled();
  });

  it("duplicate admin calls each enqueue (DB claim is the idempotency layer)", async () => {
    setupSelectSequence([
      [{ id: 42, briefingDate: "2026-08-03" }],
      [{ id: 42, briefingDate: "2026-08-03" }],
    ]);
    const r1 = await POST(makeRequest() as never, ctx("42"));
    const r2 = await POST(makeRequest() as never, ctx("42"));
    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);
    expect(mockQueueAdd).toHaveBeenCalledTimes(2);
  });
});
