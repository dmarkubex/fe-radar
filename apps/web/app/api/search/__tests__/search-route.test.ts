import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type * as AuthzModule from "@/lib/api/authz";

// S3b: requireFreshViewer always runs real verifyTokenFreshness (same-module call).
// Provide a matching users row via @fe-radar/db so route tests stay on wiring/RBAC.
const { mockFetchTimeline, mockGetRequestUser, freshnessRow } = vi.hoisted(() => ({
  mockFetchTimeline: vi.fn(),
  mockGetRequestUser: vi.fn(),
  freshnessRow: {
    current: {
      disabledAt: null as Date | null,
      role: "viewer",
      tokenVersion: 1
    }
  }
}));

vi.mock("@/lib/api/timeline-query", () => ({ fetchTimeline: mockFetchTimeline }));
vi.mock("@/lib/api/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof AuthzModule>();
  return { ...actual, getRequestUser: mockGetRequestUser };
});
vi.mock("@fe-radar/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [freshnessRow.current]
        })
      })
    })
  }),
  users: { id: "id", role: "role", disabledAt: "disabledAt", tokenVersion: "tokenVersion" }
}));

import { GET } from "../route";

const req = (url: string): NextRequest => ({ url, nextUrl: new URL(url) }) as unknown as NextRequest;
const BASE = "http://localhost/api/search";

/** Active in-session user + matching DB row for requireFreshViewer (S3b). */
function actAs(user: { id: number; role: "viewer" | "admin" | "editor"; tokenVersion?: number }): void {
  const tokenVersion = user.tokenVersion ?? 1;
  mockGetRequestUser.mockResolvedValue({ id: user.id, role: user.role, tokenVersion });
  freshnessRow.current = { disabledAt: null, role: user.role, tokenVersion };
}

beforeEach(() => {
  vi.clearAllMocks();
  actAs({ id: 1, role: "viewer", tokenVersion: 1 });
  mockFetchTimeline.mockResolvedValue({ items: [{ id: 9 }], nextCursor: null });
});

describe("GET /api/search", () => {
  it("returns 200 and passes the query string through to fetchTimeline", async () => {
    const res = await GET(req(`${BASE}?q=${encodeURIComponent("储能")}&tier=T2`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [{ id: 9 }], nextCursor: null });
    const arg = mockFetchTimeline.mock.calls[0]![0] as { search?: string; filters: { q?: string; tier?: string } };
    // search route forwards the parsed q (either as search or within filters)
    expect(JSON.stringify(arg)).toContain("储能");
    expect(arg.filters.tier).toBe("T2");
  });

  it("returns 400 for an empty query (q is required)", async () => {
    const res = await GET(req(`${BASE}?q=`));
    expect(res.status).toBe(400);
    expect(mockFetchTimeline).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid enum value", async () => {
    const res = await GET(req(`${BASE}?q=x&circle=NOPE`));
    expect(res.status).toBe(400);
    expect(mockFetchTimeline).not.toHaveBeenCalled();
  });

  // Antigravity #5 — route-level RBAC boundary (mirror of timeline route)
  it("does not let a viewer include blocked items", async () => {
    actAs({ id: 2, role: "viewer" });
    await GET(req(`${BASE}?q=x&includeBlocked=true`));
    expect((mockFetchTimeline.mock.calls[0]![0] as { includeBlocked: boolean }).includeBlocked).toBe(false);
  });

  it("lets an admin include blocked items", async () => {
    actAs({ id: 3, role: "admin" });
    await GET(req(`${BASE}?q=x&includeBlocked=true`));
    expect((mockFetchTimeline.mock.calls[0]![0] as { includeBlocked: boolean }).includeBlocked).toBe(true);
  });
});
