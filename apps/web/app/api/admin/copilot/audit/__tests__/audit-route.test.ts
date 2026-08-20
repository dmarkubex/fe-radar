import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NextRequest } from "next/server";

const { mockRequireFreshRole, mockEvaluate, mockExecute } = vi.hoisted(() => ({
  mockRequireFreshRole: vi.fn<(req: NextRequest, role: string) => Promise<Response | null>>(),
  mockEvaluate: vi.fn(),
  mockExecute: vi.fn()
}));

vi.mock("@/lib/api/authz", () => ({
  requireFreshRole: mockRequireFreshRole
}));

vi.mock("@/lib/api/copilot-access", () => ({
  evaluateCopilotAccess: mockEvaluate
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })
}));

vi.mock("@fe-radar/db", () => ({
  getDb: () => ({ execute: mockExecute })
}));

import { GET } from "../route";

function makeRequest(url = "http://localhost/api/admin/copilot/audit"): NextRequest {
  const request = new Request(url) as NextRequest;
  Object.defineProperty(request, "nextUrl", { value: new URL(url) });
  return request;
}

describe("admin GET /api/admin/copilot/audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireFreshRole.mockResolvedValue(null);
  });

  it("requires admin and does not evaluate grayscale", async () => {
    mockExecute
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);
    const res = await GET(makeRequest());
    expect(mockRequireFreshRole).toHaveBeenCalledWith(expect.anything(), "admin");
    expect(mockEvaluate).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], total: 0 });
  });

  it("rejects an illegal rating", async () => {
    const res = await GET(makeRequest("http://localhost/api/admin/copilot/audit?rating=2"));
    expect(res.status).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
