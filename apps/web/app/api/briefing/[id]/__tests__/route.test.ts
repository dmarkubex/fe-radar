import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserRole } from "@fe-radar/shared";
import type { NextRequest } from "next/server";

const { mockGetDb, mockGetRequestUser, queryResults } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockGetRequestUser: vi.fn(),
  queryResults: [] as unknown[][]
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({}))
}));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  commodityBriefings: { id: "briefingId" },
  briefingPushes: {
    id: "pushId",
    briefingId: "briefingId",
    targetId: "targetId",
    pushStatus: "pushStatus",
    attemptCount: "attemptCount",
    errorDetail: "errorDetail",
    pushedAt: "pushedAt"
  },
  briefingTargets: {
    id: "targetId",
    name: "targetName"
  }
}));

vi.mock("@/lib/api/authz", () => ({ getRequestUser: mockGetRequestUser }));

import { GET } from "../route";

type MockQueryMethod = (...args: unknown[]) => MockQuery;

interface MockQuery extends PromiseLike<unknown[]> {
  from: MockQueryMethod;
  where: MockQueryMethod;
  limit: MockQueryMethod;
  leftJoin: MockQueryMethod;
}

const request = new Request("http://localhost/api/briefing/7") as unknown as NextRequest;
const context = { params: Promise.resolve({ id: "7" }) };
const briefing = { id: 7, briefingDate: "2026-07-23", payloadJson: { summary: "行情稳定" } };
const push = {
  id: 11,
  targetId: 3,
  targetName: "采购群",
  pushStatus: "failed",
  attemptCount: 2,
  errorDetail: "webhook timeout",
  pushedAt: null
};

function createQuery(rows: unknown[]): MockQuery {
  const promise = Promise.resolve(rows);
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    limit: vi.fn(() => query),
    leftJoin: vi.fn(() => query),
    then: promise.then.bind(promise) as PromiseLike<unknown[]>["then"]
  };
  return query;
}

function setRole(role: UserRole): void {
  mockGetRequestUser.mockResolvedValue({ id: 1, role });
}

async function getDetail() {
  queryResults.splice(0, queryResults.length, [briefing], [push]);
  const response = await GET(request, context);
  return {
    response,
    body: await response.json() as {
      briefing: typeof briefing;
      pushes: Array<Record<string, unknown>>;
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryResults.length = 0;
  mockGetDb.mockReturnValue({
    select: vi.fn(() => {
      const rows = queryResults.shift();
      if (!rows) throw new Error("missing mocked query result");
      return createQuery(rows);
    })
  });
});

describe("GET /api/briefing/:id response visibility", () => {
  it.each<UserRole>(["viewer", "editor"])("%s receives push status without errorDetail", async (role) => {
    setRole(role);

    const { response, body } = await getDetail();

    expect(response.status).toBe(200);
    expect(body.briefing).toEqual(briefing);
    expect(body.pushes[0]).toMatchObject({
      id: 11,
      targetId: 3,
      targetName: "采购群",
      pushStatus: "failed",
      attemptCount: 2,
      pushedAt: null
    });
    expect(body.pushes[0]).not.toHaveProperty("errorDetail");
  });

  it("admin receives full push status including errorDetail", async () => {
    setRole("admin");

    const { response, body } = await getDetail();

    expect(response.status).toBe(200);
    expect(body.pushes[0]).toMatchObject({
      pushStatus: "failed",
      attemptCount: 2,
      errorDetail: "webhook timeout"
    });
  });
});
