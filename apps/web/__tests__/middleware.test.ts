/**
 * DMA-51 — middleware x-pathname injection
 *
 * Full round-trip test (NextRequest → NextResponse.next({ request }) → RSC headers())
 * requires the Next.js Edge Runtime which is not available in the vitest environment.
 * The behaviour is verified manually via headers() in layout.tsx in a running dev
 * server — verified manually via headers() in layout (DMA-51 acceptance §3).
 *
 * What we CAN test here is the pure header-cloning pattern used in middleware.ts:
 * cloning request.headers and setting x-pathname on the clone, then confirming
 * the clone carries the value while the original does not.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ getToken: mockGetToken }));

import middleware from "../middleware";
import type { NextRequest } from "next/server";

const mw = (path: string): Promise<{ status: number; headers: Headers }> => {
  const url = `http://localhost${path}`;
  const req = { nextUrl: new URL(url), url, headers: new Headers() } as unknown as NextRequest;
  return middleware(req);
};

// Antigravity #5 — the real auth gate is middleware.ts; cover unauth (401/redirect)
// and role boundaries (403) that the per-route tests bypass by mocking getRequestUser.
describe("middleware auth gate (Antigravity #5)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 for an unauthenticated API request", async () => {
    mockGetToken.mockResolvedValue(null);
    expect((await mw("/api/timeline")).status).toBe(401);
  });

  it("redirects an unauthenticated page request to /auth/login", async () => {
    mockGetToken.mockResolvedValue(null);
    const res = await mw("/curated");
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get("location")).toContain("/auth/login");
  });

  it("returns 403 when a viewer hits an admin API path", async () => {
    mockGetToken.mockResolvedValue({ role: "viewer", sub: "1" });
    expect((await mw("/api/admin/worker")).status).toBe(403);
  });

  it("returns 403 when a viewer hits an editor (sources) API path", async () => {
    mockGetToken.mockResolvedValue({ role: "viewer", sub: "1" });
    expect((await mw("/api/sources/5")).status).toBe(403);
  });

  it("returns 403 when a viewer hits the bare sources collection API path", async () => {
    mockGetToken.mockResolvedValue({ role: "viewer", sub: "1" });
    expect((await mw("/api/sources")).status).toBe(403);
  });

  it("returns 403 when a viewer hits the bare entities collection API path", async () => {
    mockGetToken.mockResolvedValue({ role: "viewer", sub: "1" });
    expect((await mw("/api/entities")).status).toBe(403);
  });

  it("returns 403 when an editor hits an admin API path", async () => {
    mockGetToken.mockResolvedValue({ role: "editor", sub: "1" });
    expect((await mw("/api/users")).status).toBe(403);
  });

  it("allows an admin through an admin API path (no 401/403)", async () => {
    mockGetToken.mockResolvedValue({ role: "admin", sub: "1" });
    const res = await mw("/api/admin/worker");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("allows a viewer through a timeline API path", async () => {
    mockGetToken.mockResolvedValue({ role: "viewer", sub: "1" });
    const res = await mw("/api/timeline");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe("middleware x-pathname header injection pattern (DMA-51)", () => {
  it("cloned Headers object carries the injected x-pathname value", () => {
    const original = new Headers({ "content-type": "text/html" });
    const clone = new Headers(original);
    clone.set("x-pathname", "/curated");

    expect(clone.get("x-pathname")).toBe("/curated");
  });

  it("original Headers object is not mutated by the clone", () => {
    const original = new Headers({ "content-type": "text/html" });
    const clone = new Headers(original);
    clone.set("x-pathname", "/curated");

    expect(original.get("x-pathname")).toBeNull();
  });

  it("x-pathname is preserved after being set on the clone", () => {
    const paths = ["/", "/curated", "/alerts", "/admin/dashboard"];
    for (const pathname of paths) {
      const clone = new Headers();
      clone.set("x-pathname", pathname);
      expect(clone.get("x-pathname")).toBe(pathname);
    }
  });
});
