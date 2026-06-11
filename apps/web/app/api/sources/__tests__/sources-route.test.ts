import { describe, it, expect, vi, beforeEach } from "vitest";

// GET /api/sources route integration: DB layer + mock-mode mocked.
const { mockListSources, mockGetDb, mockIsMockMode, mockRequireRequestRole } = vi.hoisted(() => ({
  mockListSources: vi.fn(),
  mockGetDb: vi.fn(() => ({})),
  mockIsMockMode: vi.fn(() => false),
  mockRequireRequestRole: vi.fn(async (): Promise<Response | null> => null),
}));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  listSources: mockListSources,
  createSource: vi.fn(),
}));
vi.mock("@/lib/mock-mode", () => ({ isMockMode: mockIsMockMode }));
vi.mock("@/lib/mock-data", () => ({ mockSources: [{ id: 99, name: "MOCK" }] }));
vi.mock("@/lib/api/authz", () => ({ requireRequestRole: mockRequireRequestRole }));

import { GET } from "../route";

import type { NextRequest } from "next/server";

const req = (url: string): NextRequest => ({ url } as unknown as NextRequest);
const BASE = "http://localhost/api/sources";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsMockMode.mockReturnValue(false);
  mockRequireRequestRole.mockResolvedValue(null);
  mockListSources.mockResolvedValue([{ id: 1, name: "S1", tier: "T1" }]);
});

describe("GET /api/sources", () => {
  it("returns the live list and forwards a valid tier filter", async () => {
    const res = await GET(req(`${BASE}?tier=T1`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [{ id: 1, name: "S1", tier: "T1" }], nextCursor: null });
    expect(mockListSources).toHaveBeenCalledOnce();
    const filters = mockListSources.mock.calls[0]![1] as { tier?: string };
    expect(filters.tier).toBe("T1");
    expect(mockRequireRequestRole).toHaveBeenCalledWith(expect.anything(), "editor");
  });

  it("returns auth errors before hitting the DB", async () => {
    mockRequireRequestRole.mockResolvedValue(
      Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 })
    );
    const res = await GET(req(BASE));
    expect(res.status).toBe(401);
    expect(mockListSources).not.toHaveBeenCalled();
  });

  it("ignores an invalid tier (passes undefined, no 400)", async () => {
    const res = await GET(req(`${BASE}?tier=ZZ`));
    expect(res.status).toBe(200);
    const filters = mockListSources.mock.calls[0]![1] as { tier?: string };
    expect(filters.tier).toBeUndefined();
  });

  it("returns mock sources in mock mode without hitting the DB", async () => {
    mockIsMockMode.mockReturnValue(true);
    const res = await GET(req(`${BASE}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [{ id: 99, name: "MOCK" }], nextCursor: null });
    expect(mockListSources).not.toHaveBeenCalled();
  });
});
