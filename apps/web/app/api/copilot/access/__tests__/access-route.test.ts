import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NextRequest } from "next/server";

const { mockRequireFreshRole, mockEvaluate, mockGetRequestUser } = vi.hoisted(() => ({
  mockRequireFreshRole: vi.fn<(req: NextRequest, role: string) => Promise<Response | null>>(),
  mockEvaluate: vi.fn<(userId: number) => Promise<boolean>>(),
  mockGetRequestUser: vi.fn<() => Promise<{ id?: number; role?: string }>>()
}));

vi.mock("@/lib/api/authz", () => ({
  requireFreshRole: mockRequireFreshRole,
  getRequestUser: mockGetRequestUser
}));

vi.mock("@/lib/api/copilot-access", () => ({
  evaluateCopilotAccess: mockEvaluate
}));

vi.mock("@/lib/logger", () => ({
  webLogger: { error: vi.fn() }
}));

import { GET } from "../route";

function makeRequest(): NextRequest {
  return new Request("http://localhost/api/copilot/access") as NextRequest;
}

describe("GET /api/copilot/access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestUser.mockResolvedValue({ id: 1, role: "viewer" });
    mockRequireFreshRole.mockResolvedValue(null);
  });

  it("returns 401 SESSION_REVOKED when requireFreshRole fails", async () => {
    mockRequireFreshRole.mockResolvedValue(
      Response.json({ error: { code: "SESSION_REVOKED", message: "会话已失效，请重新登录" } }, { status: 401 })
    );
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "SESSION_REVOKED" } });
  });

  it("returns 200 {enabled:false} when the flag is closed", async () => {
    mockEvaluate.mockResolvedValue(false);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it("returns 200 {enabled:false} when flags throw and never 403", async () => {
    mockEvaluate.mockRejectedValue(new Error("db"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it("returns 200 {enabled:true} when the user is allow-listed", async () => {
    mockEvaluate.mockResolvedValue(true);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true });
  });
});
