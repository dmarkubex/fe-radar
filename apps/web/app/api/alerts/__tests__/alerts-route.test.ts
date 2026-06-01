import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { mockFetchAlerts } = vi.hoisted(() => ({ mockFetchAlerts: vi.fn() }));

vi.mock("@/lib/api/alerts-query", () => ({ fetchAlerts: mockFetchAlerts }));

import { GET } from "../route";

const req = (url: string): NextRequest => ({ url, nextUrl: new URL(url) }) as unknown as NextRequest;
const BASE = "http://localhost/api/alerts";

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchAlerts.mockResolvedValue({ items: [{ id: 5, alertType: "own" }], nextCursor: null });
});

describe("GET /api/alerts", () => {
  it("returns 200 and forwards parsed filters to fetchAlerts", async () => {
    const res = await GET(req(`${BASE}?type=own&level=L1`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [{ id: 5, alertType: "own" }], nextCursor: null });
    const arg = mockFetchAlerts.mock.calls[0]![0] as { type?: string; level?: string };
    expect(arg.type).toBe("own");
    expect(arg.level).toBe("L1");
  });

  it("returns 400 for an invalid alert level", async () => {
    const res = await GET(req(`${BASE}?level=L9`));
    expect(res.status).toBe(400);
    expect(mockFetchAlerts).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid alert type", async () => {
    const res = await GET(req(`${BASE}?type=bogus`));
    expect(res.status).toBe(400);
    expect(mockFetchAlerts).not.toHaveBeenCalled();
  });
});
