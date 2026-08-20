import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NextRequest } from "next/server";

const {
  mockRequireFreshRole,
  mockGetRequestUser,
  mockEvaluate,
  mockFetchItemDetail,
  mockVisible,
  selectLimit
} = vi.hoisted(() => ({
  mockRequireFreshRole: vi.fn<(req: NextRequest, role: string) => Promise<Response | null>>(),
  mockGetRequestUser: vi.fn<() => Promise<{ id?: number; role?: string }>>(),
  mockEvaluate: vi.fn<(userId: number) => Promise<boolean>>(),
  mockFetchItemDetail: vi.fn(),
  mockVisible: vi.fn(() => ({ op: "visible" })),
  selectLimit: vi.fn()
}));

vi.mock("@/lib/api/authz", () => ({
  requireFreshRole: mockRequireFreshRole,
  getRequestUser: mockGetRequestUser
}));

vi.mock("@/lib/api/copilot-access", () => ({
  evaluateCopilotAccess: mockEvaluate,
  copilotDisabled: () =>
    Response.json(
      { error: { code: "COPILOT_DISABLED", message: "Copilot 未对当前账号开放" } },
      { status: 403 }
    )
}));

vi.mock("@/lib/api/timeline-query", () => ({
  visibleItemConditions: mockVisible,
  fetchItemDetail: mockFetchItemDetail
}));

vi.mock("@/lib/logger", () => ({
  webLogger: { error: vi.fn() }
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] })
}));

vi.mock("@fe-radar/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => {
        const query = {
          innerJoin: () => query,
          leftJoin: () => query,
          where: () => ({ limit: selectLimit })
        };
        return query;
      }
    })
  }),
  items: { id: "items.id", title: "items.title", sourceId: "items.sourceId" },
  sources: { id: "sources.id", name: "sources.name" },
  itemAnalysis: { itemId: "itemAnalysis.itemId", summaryZh: "itemAnalysis.summaryZh", scoredAt: "itemAnalysis.scoredAt" },
  clusterItems: { itemId: "clusterItems.itemId", clusterId: "clusterItems.clusterId" },
  clusters: { id: "clusters.id" }
}));

import { GET } from "../route";

function makeRequest(): NextRequest {
  return new Request("http://localhost/api/copilot/cite/42") as NextRequest;
}

describe("GET /api/copilot/cite/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireFreshRole.mockResolvedValue(null);
    mockGetRequestUser.mockResolvedValue({ id: 1, role: "viewer" });
    mockEvaluate.mockResolvedValue(true);
    mockVisible.mockReturnValue({ op: "visible" });
  });

  it("does not call fetchItemDetail or the items API", async () => {
    selectLimit.mockResolvedValue([
      {
        id: 42,
        title: "visible",
        summaryZh: "摘要",
        sourceName: "电缆网",
        scoredAt: new Date("2026-08-19T00:00:00.000Z")
      }
    ]);
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: 42,
      title: "visible",
      summaryZh: "摘要",
      sourceName: "电缆网",
      scoredAt: "2026-08-19T00:00:00.000Z"
    });
    expect(mockFetchItemDetail).not.toHaveBeenCalled();
    expect(mockVisible).toHaveBeenCalledWith({}, false, undefined, undefined, true, false);
  });

  it("returns 403 COPILOT_DISABLED when grayscale is off", async () => {
    mockEvaluate.mockResolvedValue(false);
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "COPILOT_DISABLED" } });
    expect(selectLimit).not.toHaveBeenCalled();
    expect(mockFetchItemDetail).not.toHaveBeenCalled();
  });

  it("returns 404 COPILOT_ITEM_NOT_FOUND when the item is not visible", async () => {
    selectLimit.mockResolvedValue([]);
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "COPILOT_ITEM_NOT_FOUND" } });
    expect(mockFetchItemDetail).not.toHaveBeenCalled();
  });
});
