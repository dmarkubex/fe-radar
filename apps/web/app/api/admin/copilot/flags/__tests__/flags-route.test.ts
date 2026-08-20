import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NextRequest } from "next/server";

const {
  mockRequireFreshRole,
  mockGetRequestUser,
  mockEvaluate,
  selectLimit,
  updateReturning,
  insertReturning
} = vi.hoisted(() => ({
  mockRequireFreshRole: vi.fn<(req: NextRequest, role: string) => Promise<Response | null>>(),
  mockGetRequestUser: vi.fn<() => Promise<{ id?: number; role?: string }>>(),
  mockEvaluate: vi.fn(),
  selectLimit: vi.fn(),
  updateReturning: vi.fn(),
  insertReturning: vi.fn()
}));

vi.mock("@/lib/api/authz", () => ({
  requireFreshRole: mockRequireFreshRole,
  getRequestUser: mockGetRequestUser
}));

vi.mock("@/lib/api/copilot-access", () => ({
  evaluateCopilotAccess: mockEvaluate
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val })
}));

vi.mock("@fe-radar/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: selectLimit })
      })
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: updateReturning })
      })
    }),
    insert: () => ({
      values: () => ({ returning: insertReturning })
    })
  }),
  copilotFeatureFlags: {
    key: "key",
    enabled: "enabled",
    userIds: "userIds",
    depts: "depts",
    updatedAt: "updatedAt",
    updatedBy: "updatedBy"
  }
}));

import { GET, PUT } from "../route";

function makeRequest(method: string, body?: unknown): NextRequest {
  return new Request("http://localhost/api/admin/copilot/flags", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  }) as NextRequest;
}

describe("admin /api/admin/copilot/flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestUser.mockResolvedValue({ id: 99, role: "admin" });
    mockRequireFreshRole.mockResolvedValue(null);
  });

  it("requires admin on GET and does not evaluate grayscale", async () => {
    selectLimit.mockResolvedValue([
      {
        enabled: false,
        userIds: [],
        depts: [],
        updatedAt: new Date("2026-08-20T00:00:00.000Z"),
        updatedBy: 99
      }
    ]);
    const res = await GET(makeRequest("GET"));
    expect(mockRequireFreshRole).toHaveBeenCalledWith(expect.anything(), "admin");
    expect(mockEvaluate).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: false,
      userIds: [],
      depts: [],
      updatedAt: "2026-08-20T00:00:00.000Z",
      updatedBy: 99
    });
  });

  it("returns 400 for an illegal PUT body", async () => {
    const res = await PUT(makeRequest("PUT", { enabled: "yes" }));
    expect(res.status).toBe(400);
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it("writes flags without evaluateCopilotAccess", async () => {
    updateReturning.mockResolvedValue([
      {
        enabled: true,
        userIds: [1],
        depts: ["采购"],
        updatedAt: new Date("2026-08-20T01:00:00.000Z"),
        updatedBy: 99
      }
    ]);
    const res = await PUT(makeRequest("PUT", { enabled: true, userIds: [1], depts: ["采购"] }));
    expect(mockRequireFreshRole).toHaveBeenCalledWith(expect.anything(), "admin");
    expect(mockEvaluate).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: true, userIds: [1], depts: ["采购"] });
  });
});
