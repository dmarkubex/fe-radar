import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type * as AuthzModule from "@/lib/api/authz";

// Route-level integration test: real zod schema + real canIncludeBlocked,
// query layer + getRequestUser mocked. Asserts request wiring, validation, RBAC gating.
//
// S3b: requireFreshViewer always runs real verifyTokenFreshness (same-module call;
// mocking the export does not intercept). Provide a matching users row via @fe-radar/db.
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
const BASE = "http://localhost/api/timeline";

/** Active in-session user + matching DB row for requireFreshViewer (S3b). */
function actAs(user: { id: number; role: "viewer" | "admin" | "editor"; tokenVersion?: number }): void {
  const tokenVersion = user.tokenVersion ?? 1;
  mockGetRequestUser.mockResolvedValue({ id: user.id, role: user.role, tokenVersion });
  freshnessRow.current = { disabledAt: null, role: user.role, tokenVersion };
}

beforeEach(() => {
  vi.clearAllMocks();
  actAs({ id: 1, role: "viewer", tokenVersion: 1 });
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
    actAs({ id: 2, role: "viewer" });
    await GET(req(`${BASE}?includeBlocked=true`));
    expect((mockFetchTimeline.mock.calls[0]![0] as { includeBlocked: boolean }).includeBlocked).toBe(false);
  });

  it("lets an admin include blocked items", async () => {
    actAs({ id: 3, role: "admin" });
    await GET(req(`${BASE}?includeBlocked=true`));
    expect((mockFetchTimeline.mock.calls[0]![0] as { includeBlocked: boolean }).includeBlocked).toBe(true);
  });

  // S3b / T-SEC-06: nails fail-closed when JWT lacks tokenVersion.
  // Real requireFreshViewer + verifyTokenFreshness path (DB row present, claim missing).
  // Re-adding "missing tokenVersion → skip verify" early return would flip this to 200.
  it("returns 401 when session lacks tokenVersion (S3b / T-SEC-06)", async () => {
    mockGetRequestUser.mockResolvedValue({ id: 1, role: "viewer" }); // intentionally no tokenVersion
    freshnessRow.current = { disabledAt: null, role: "viewer", tokenVersion: 1 };

    const res = await GET(req(BASE));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("SESSION_REVOKED");
    expect(mockFetchTimeline).not.toHaveBeenCalled();
  });
});
