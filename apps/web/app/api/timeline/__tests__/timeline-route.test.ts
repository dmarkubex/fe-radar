import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Route-level integration test: real zod schema + real canIncludeBlocked,
// query layer + getRequestUser mocked. Asserts request wiring, validation, RBAC gating.
const { mockFetchTimeline, mockGetRequestUser } = vi.hoisted(() => ({
  mockFetchTimeline: vi.fn(),
  mockGetRequestUser: vi.fn(),
}));

vi.mock("@/lib/api/timeline-query", () => ({ fetchTimeline: mockFetchTimeline }));
vi.mock("@/lib/api/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/authz")>();
  return { ...actual, getRequestUser: mockGetRequestUser };
});

import { GET } from "../route";

const req = (url: string): NextRequest => ({ url, nextUrl: new URL(url) }) as unknown as NextRequest;
const BASE = "http://localhost/api/timeline";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRequestUser.mockResolvedValue({ id: 1, role: "viewer" });
  mockFetchTimeline.mockResolvedValue({ items: [{ id: 1 }], nextCursor: null });
});

describe("GET /api/timeline", () => {
  it("returns 200 and forwards parsed filters to fetchTimeline", async () => {
    const res = await GET(req(`${BASE}?category=policy&circle=C1&tier=T1`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [{ id: 1 }], nextCursor: null });
    expect(mockFetchTimeline).toHaveBeenCalledOnce();
    const arg = mockFetchTimeline.mock.calls[0]![0] as { filters: { circle?: string; tier?: string } };
    expect(arg.filters.circle).toBe("C1");
    expect(arg.filters.tier).toBe("T1");
  });

  it("returns 400 for an invalid enum value", async () => {
    const res = await GET(req(`${BASE}?circle=ZZ`));
    expect(res.status).toBe(400);
    expect(mockFetchTimeline).not.toHaveBeenCalled();
  });

  it("does not let a viewer include blocked items", async () => {
    mockGetRequestUser.mockResolvedValue({ id: 2, role: "viewer" });
    await GET(req(`${BASE}?includeBlocked=true`));
    expect((mockFetchTimeline.mock.calls[0]![0] as { includeBlocked: boolean }).includeBlocked).toBe(false);
  });

  it("lets an admin include blocked items", async () => {
    mockGetRequestUser.mockResolvedValue({ id: 3, role: "admin" });
    await GET(req(`${BASE}?includeBlocked=true`));
    expect((mockFetchTimeline.mock.calls[0]![0] as { includeBlocked: boolean }).includeBlocked).toBe(true);
  });
});
