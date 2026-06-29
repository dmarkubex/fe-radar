import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NextRequest } from "next/server";
import type { DbClient } from "@fe-radar/db";
import type { fetchItemDetail as actualFetchItemDetail } from "../../../../../lib/api/timeline-query";
import type { ItemDetailDto } from "@/lib/api/timeline-query";

type User = { id?: number; role?: "admin" | "editor" | "viewer" };
type FeedbackRow = {
  id: number;
  itemId: number;
  userId: number;
  vote: -1 | 0 | 1;
  reason?: string;
};
type QueryPredicate =
  | { op: "and"; conditions: QueryPredicate[] }
  | { op: "or"; conditions: QueryPredicate[] }
  | { op: "not"; condition: QueryPredicate }
  | { op: "eq" | "ne"; column: string; value: unknown }
  | { op: "inArray"; column: string; values: unknown[] }
  | { op: "isNull" | "isNotNull"; column: string };
type DetailSourceRow = Record<string, unknown> & {
  dbRow: Record<string, unknown>;
  detail: ItemDetailDto;
};

const users = vi.hoisted(() => ({
  current: {} as User
}));

const dbState = vi.hoisted(() => ({
  existingItems: new Set<number>(),
  feedbacks: new Map<string, FeedbackRow>(),
  nextFeedbackId: 1
}));

const getDbMock = vi.hoisted(() => vi.fn());
const fetchItemDetailMock = vi.hoisted(() => vi.fn());
const mirofishMock = vi.hoisted(() => {
  class ConfigError extends Error {}
  return {
    ConfigError,
    createProject: vi.fn()
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: Array<QueryPredicate | undefined>) => ({
    op: "and",
    conditions: conditions.filter(Boolean)
  })),
  desc: vi.fn((column) => ({ direction: "desc", column })),
  eq: vi.fn((column, value) => ({ op: "eq", column, value })),
  ilike: vi.fn((column, value) => ({ op: "ilike", column, value })),
  inArray: vi.fn((column, values) => ({ op: "inArray", column, values })),
  isNotNull: vi.fn((column) => ({ op: "isNotNull", column })),
  isNull: vi.fn((column) => ({ op: "isNull", column })),
  lt: vi.fn((column, value) => ({ op: "lt", column, value })),
  ne: vi.fn((column, value) => ({ op: "ne", column, value })),
  not: vi.fn((condition) => ({ op: "not", condition })),
  or: vi.fn((...conditions: Array<QueryPredicate | undefined>) => ({
    op: "or",
    conditions: conditions.filter(Boolean)
  })),
  sql: vi.fn(() => "sql")
}));

vi.mock("@/lib/api/authz", () => ({
  canIncludeBlocked: (role: User["role"], includeBlocked: boolean) =>
    includeBlocked && role === "admin",
  getRequestUser: vi.fn(async () => users.current),
  notFound: () =>
    Response.json(
      { error: { code: "NOT_FOUND", message: "条目不存在或不可访问" } },
      { status: 404 }
    ),
  unauthorized: () =>
    Response.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录" } },
      { status: 401 }
    )
}));

vi.mock("@/lib/api/timeline-query", () => ({
  fetchItemDetail: fetchItemDetailMock
}));

vi.mock("@/lib/api/mirofish", () => ({
  MirofishConfigError: mirofishMock.ConfigError,
  createMirofishProjectFromItem: mirofishMock.createProject
}));

vi.mock("@/lib/logger", () => ({
  webLogger: { warn: vi.fn() }
}));

vi.mock("@/lib/api/cursor", () => ({
  decodeCursor: vi.fn(() => null),
  encodeCursor: vi.fn(() => "cursor")
}));

vi.mock("@/lib/api/item-visibility", () => ({
  BLOCKED_QUOTA_STATES: [
    "pending_over_quota",
    "dropped_quota_expired",
    "dropped_filter"
  ],
  MANUAL_SCRUB_SUMMARY: "[需人工脱敏]"
}));

vi.mock(
  "@/lib/api/timeline-schema",
  async () => import("../../../../../lib/api/timeline-schema")
);

vi.mock("@/lib/mock-data", () => ({
  mockFetchItemDetail: vi.fn(),
  mockFetchTimeline: vi.fn()
}));

vi.mock("@/lib/mock-mode", () => ({
  isMockMode: vi.fn(() => false)
}));

vi.mock("@fe-radar/db", () => ({
  clusterItems: {
    clusterId: "clusterItems.clusterId",
    itemId: "clusterItems.itemId",
    similarity: "clusterItems.similarity"
  },
  clusters: {
    eventType: "clusters.eventType",
    id: "clusters.id",
    leadItemId: "clusters.leadItemId"
  },
  entities: {
    canonicalName: "entities.canonicalName",
    circle: "entities.circle",
    id: "entities.id",
    type: "entities.type"
  },
  feedbacks: {
    itemId: "feedbacks.itemId",
    userId: "feedbacks.userId"
  },
  getDb: getDbMock,
  itemAnalysis: {
    alertLevel: "itemAnalysis.alertLevel",
    alertType: "itemAnalysis.alertType",
    category: "itemAnalysis.category",
    d1Policy: "itemAnalysis.d1Policy",
    d2Chain: "itemAnalysis.d2Chain",
    d3Market: "itemAnalysis.d3Market",
    d4Tech: "itemAnalysis.d4Tech",
    d5Business: "itemAnalysis.d5Business",
    isCurated: "itemAnalysis.isCurated",
    itemId: "itemAnalysis.itemId",
    qualityScore: "itemAnalysis.qualityScore",
    quotaState: "itemAnalysis.quotaState",
    scoredAt: "itemAnalysis.scoredAt",
    summaryZh: "itemAnalysis.summaryZh",
    topCircle: "itemAnalysis.topCircle",
    translationZh: "itemAnalysis.translationZh"
  },
  itemEntities: {
    entityId: "itemEntities.entityId",
    itemId: "itemEntities.itemId",
    span: "itemEntities.span"
  },
  items: {
    content: "items.content",
    fetchedAt: "items.fetchedAt",
    id: "items.id",
    publishedAt: "items.publishedAt",
    sourceId: "items.sourceId",
    title: "items.title",
    url: "items.url"
  },
  sources: {
    category: "sources.category",
    fetcherType: "sources.fetcherType",
    id: "sources.id",
    name: "sources.name",
    tier: "sources.tier"
  }
}));

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  const request = new Request(url, init) as NextRequest;
  Object.defineProperty(request, "nextUrl", { value: new URL(url) });
  return request;
}

function jsonRequest(url: string, body: unknown): NextRequest {
  return makeNextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function createFakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: (condition: { value: number }) => ({
          limit: async () =>
            dbState.existingItems.has(condition.value)
              ? [{ id: condition.value }]
              : []
        })
      })
    }),
    insert: () => ({
      values: (value: Omit<FeedbackRow, "id">) => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            const key = `${value.itemId}:${value.userId}`;
            const existing = dbState.feedbacks.get(key);
            const row: FeedbackRow = {
              id: existing?.id ?? dbState.nextFeedbackId++,
              itemId: value.itemId,
              userId: value.userId,
              vote: value.vote,
              reason: value.reason
            };
            dbState.feedbacks.set(key, row);
            return [row];
          }
        })
      })
    })
  };
}

function columnValue(row: DetailSourceRow, columnOrValue: unknown) {
  if (typeof columnOrValue === "string" && columnOrValue in row) {
    return row[columnOrValue];
  }
  return columnOrValue;
}

function matchesPredicate(
  row: DetailSourceRow,
  predicate: QueryPredicate
): boolean {
  switch (predicate.op) {
    case "and":
      return predicate.conditions.every((condition) =>
        matchesPredicate(row, condition)
      );
    case "or":
      return predicate.conditions.some((condition) =>
        matchesPredicate(row, condition)
      );
    case "not":
      return !matchesPredicate(row, predicate.condition);
    case "eq":
      return (
        columnValue(row, predicate.column) === columnValue(row, predicate.value)
      );
    case "ne":
      return (
        columnValue(row, predicate.column) !== columnValue(row, predicate.value)
      );
    case "inArray":
      return predicate.values.includes(columnValue(row, predicate.column));
    case "isNull":
      return columnValue(row, predicate.column) == null;
    case "isNotNull":
      return columnValue(row, predicate.column) != null;
  }
}

function createDetailFixture(quotaState: string): DetailSourceRow {
  const publishedAt = new Date("2026-01-01T00:00:00.000Z");
  const scoredAt = new Date("2026-01-02T00:00:00.000Z");
  return {
    "clusters.id": null,
    "clusters.leadItemId": null,
    "itemAnalysis.alertLevel": null,
    "itemAnalysis.alertType": null,
    "itemAnalysis.category": "policy",
    "itemAnalysis.d1Policy": 10,
    "itemAnalysis.d2Chain": 20,
    "itemAnalysis.d3Market": 30,
    "itemAnalysis.d4Tech": 40,
    "itemAnalysis.d5Business": 50,
    "itemAnalysis.itemId": 42,
    "itemAnalysis.qualityScore": 88,
    "itemAnalysis.quotaState": quotaState,
    "itemAnalysis.scoredAt": scoredAt,
    "itemAnalysis.summaryZh": "visible summary",
    "itemAnalysis.topCircle": "产业",
    "itemAnalysis.translationZh": "translation",
    "items.content": "source content",
    "items.id": 42,
    "items.publishedAt": publishedAt,
    "items.sourceId": 1,
    "items.title": "blocked detail",
    "items.url": "https://radar.test/item/42",
    "sources.category": "news",
    "sources.fetcherType": "html",
    "sources.id": 1,
    "sources.name": "Test Source",
    "sources.tier": "tier1",
    dbRow: {
      id: 42,
      title: "blocked detail",
      url: "https://radar.test/item/42",
      sourceName: "Test Source",
      sourceTier: "tier1",
      sourceCategory: "news",
      sourceFetcherType: "html",
      publishedAt,
      scoredAt,
      summaryZh: "visible summary",
      category: "policy",
      topCircle: "产业",
      qualityScore: 88,
      alertType: null,
      alertLevel: null,
      clusterId: null,
      eventType: null,
      relatedCount: 0,
      content: "source content",
      translationZh: "translation",
      d1Policy: 10,
      d2Chain: 20,
      d3Market: 30,
      d4Tech: 40,
      d5Business: 50
    },
    detail: {
      id: 42,
      title: "blocked detail",
      url: "https://radar.test/item/42",
      sourceName: "Test Source",
      sourceTier: "tier1",
      sourceCategory: "news",
      sourceFetcherType: "html",
      displayUrl: "https://radar.test/item/42",
      acquisitionLabel: null,
      publishedAt: publishedAt.toISOString(),
      scoredAt: scoredAt.toISOString(),
      summaryZh: "visible summary",
      category: "policy",
      topCircle: "产业",
      qualityScore: 88,
      alertType: null,
      alertLevel: null,
      clusterId: null,
      eventType: null,
      relatedCount: 0,
      content: "source content",
      translationZh: "translation",
      scores: {
        d1Policy: 10,
        d2Chain: 20,
        d3Market: 30,
        d4Tech: 40,
        d5Business: 50
      },
      entities: [],
      clusterItems: []
    }
  };
}

function createFakeDetailDb(sourceRow: DetailSourceRow) {
  return {
    select: () => ({
      from: (table: unknown) => {
        const isItemsTable =
          typeof table === "object" &&
          table !== null &&
          "id" in table &&
          table.id === "items.id";
        const query = {
          innerJoin: () => query,
          leftJoin: () => query,
          where: (condition: QueryPredicate) =>
            isItemsTable
              ? {
                  limit: async () =>
                    matchesPredicate(sourceRow, condition)
                      ? [sourceRow.dbRow]
                      : []
                }
              : Promise.resolve([])
        };
        return query;
      }
    })
  };
}

describe("/api/items/[id]", () => {
  beforeEach(() => {
    users.current = {};
    dbState.existingItems = new Set([42]);
    dbState.feedbacks = new Map();
    dbState.nextFeedbackId = 1;
    getDbMock.mockReturnValue(createFakeDb());
    fetchItemDetailMock.mockReset();
    mirofishMock.createProject.mockReset();
  });

  describe("GET detail", () => {
    it("returns 404 when the item detail query finds no visible row", async () => {
      const { GET } = await import("../route");
      users.current = { id: 1, role: "viewer" };
      fetchItemDetailMock.mockResolvedValue(null);

      const response = await GET(
        makeNextRequest("https://radar.test/api/items/42"),
        params("42")
      );

      expect(response.status).toBe(404);
      expect(fetchItemDetailMock).toHaveBeenCalledWith(42, {
        includeBlocked: false
      });
    });

    it.each(["pending_over_quota", "dropped_quota_expired", "dropped_filter"])(
      "filters %s rows through fetchItemDetail quota visibility",
      async (quotaState) => {
        const { fetchItemDetail } = await vi.importActual<{
          fetchItemDetail: typeof actualFetchItemDetail;
        }>("../../../../../lib/api/timeline-query");
        const db = createFakeDetailDb(
          createDetailFixture(quotaState)
        ) as unknown as DbClient;

        const hidden = await fetchItemDetail(42, { db, includeBlocked: false });
        const visible = await fetchItemDetail(42, { db, includeBlocked: true });

        expect(hidden).toBeNull();
        expect(visible).toMatchObject({
          id: 42,
          title: "blocked detail",
          entities: [],
          clusterItems: []
        });
      }
    );

    it("hides crawl/risk-search original URL in the detail DTO", async () => {
      const { fetchItemDetail } = await vi.importActual<{
        fetchItemDetail: typeof actualFetchItemDetail;
      }>("../../../../../lib/api/timeline-query");
      const fixture = createDetailFixture("admitted");
      fixture["sources.category"] = "风险检索";
      fixture["sources.fetcherType"] = "crawl";
      fixture.dbRow.sourceCategory = "风险检索";
      fixture.dbRow.sourceFetcherType = "crawl";
      const db = createFakeDetailDb(fixture) as unknown as DbClient;

      const detail = await fetchItemDetail(42, { db });

      expect(detail).toMatchObject({
        id: 42,
        url: "/items/42",
        displayUrl: null,
        sourceFetcherType: "crawl",
        acquisitionLabel: "AI检索摘要"
      });
    });

    it("allows only admins to request blocked item visibility", async () => {
      const { GET } = await import("../route");
      users.current = { id: 1, role: "admin" };
      fetchItemDetailMock.mockResolvedValue({
        id: 42,
        title: "blocked detail"
      });

      const response = await GET(
        makeNextRequest("https://radar.test/api/items/42?includeBlocked=true"),
        params("42")
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.item).toMatchObject({ id: 42, title: "blocked detail" });
      expect(fetchItemDetailMock).toHaveBeenCalledWith(42, {
        includeBlocked: true
      });
    });

    it("ignores includeBlocked for non-admin users", async () => {
      const { GET } = await import("../route");
      users.current = { id: 1, role: "editor" };
      fetchItemDetailMock.mockResolvedValue(null);

      const response = await GET(
        makeNextRequest("https://radar.test/api/items/42?includeBlocked=true"),
        params("42")
      );

      expect(response.status).toBe(404);
      expect(fetchItemDetailMock).toHaveBeenCalledWith(42, {
        includeBlocked: false
      });
    });
  });

  describe("POST mirofish", () => {
    it("requires editor role or above", async () => {
      const { POST } = await import("../mirofish/route");
      users.current = { id: 7, role: "viewer" };

      const response = await POST(
        makeNextRequest("https://radar.test/api/items/42/mirofish"),
        params("42")
      );

      expect(response.status).toBe(403);
      expect(fetchItemDetailMock).not.toHaveBeenCalled();
      expect(mirofishMock.createProject).not.toHaveBeenCalled();
    });

    it("creates a MiroFish project from item detail", async () => {
      const { POST } = await import("../mirofish/route");
      users.current = { id: 7, role: "editor" };
      const item = { id: 42, title: "detail" };
      fetchItemDetailMock.mockResolvedValue(item);
      mirofishMock.createProject.mockResolvedValue({
        projectId: "proj_123",
        projectUrl: "http://mirofish.local/process/proj_123"
      });

      const response = await POST(
        makeNextRequest("https://radar.test/api/items/42/mirofish"),
        params("42")
      );
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(fetchItemDetailMock).toHaveBeenCalledWith(42, { includeBlocked: false });
      expect(mirofishMock.createProject).toHaveBeenCalledWith(item);
      expect(payload).toEqual({
        itemId: 42,
        projectId: "proj_123",
        projectUrl: "http://mirofish.local/process/proj_123"
      });
    });

    it("reports missing MiroFish config as 503", async () => {
      const { POST } = await import("../mirofish/route");
      users.current = { id: 7, role: "editor" };
      fetchItemDetailMock.mockResolvedValue({ id: 42, title: "detail" });
      mirofishMock.createProject.mockRejectedValue(new mirofishMock.ConfigError("missing config"));

      const response = await POST(
        makeNextRequest("https://radar.test/api/items/42/mirofish"),
        params("42")
      );
      const payload = await response.json();

      expect(response.status).toBe(503);
      expect(payload.error.code).toBe("MIROFISH_NOT_CONFIGURED");
    });
  });

  describe("POST feedback", () => {
    it("requires an authenticated user", async () => {
      const { POST } = await import("../feedback/route");
      users.current = {};

      const response = await POST(
        jsonRequest("https://radar.test/api/items/42/feedback", { vote: 1 }),
        params("42")
      );

      expect(response.status).toBe(401);
      expect(getDbMock).not.toHaveBeenCalled();
    });

    it.each([
      { body: { vote: 2 }, name: "invalid vote" },
      {
        body: { vote: 1, reason: "x".repeat(501) },
        name: "reason over 500 chars"
      }
    ])("rejects $name", async ({ body }) => {
      const { POST } = await import("../feedback/route");
      users.current = { id: 7, role: "viewer" };

      const response = await POST(
        jsonRequest("https://radar.test/api/items/42/feedback", body),
        params("42")
      );
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error.code).toBe("VALIDATION_ERROR");
      expect(getDbMock).not.toHaveBeenCalled();
    });

    it("returns 404 when the item does not exist", async () => {
      const { POST } = await import("../feedback/route");
      users.current = { id: 7, role: "viewer" };

      const response = await POST(
        jsonRequest("https://radar.test/api/items/404/feedback", { vote: 1 }),
        params("404")
      );

      expect(response.status).toBe(404);
      expect(dbState.feedbacks.size).toBe(0);
    });

    it("updates an existing feedback row for the same item and user", async () => {
      const { POST } = await import("../feedback/route");
      users.current = { id: 7, role: "viewer" };

      const first = await POST(
        jsonRequest("https://radar.test/api/items/42/feedback", {
          vote: 1,
          reason: "useful"
        }),
        params("42")
      );
      const second = await POST(
        jsonRequest("https://radar.test/api/items/42/feedback", {
          vote: -1,
          reason: "duplicate"
        }),
        params("42")
      );
      const secondBody = await second.json();

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(dbState.feedbacks.size).toBe(1);
      expect(secondBody.feedback).toMatchObject({
        id: 1,
        itemId: 42,
        userId: 7,
        vote: -1,
        reason: "duplicate"
      });
    });

    it("keeps feedback scoped by user", async () => {
      const { POST } = await import("../feedback/route");

      users.current = { id: 7, role: "viewer" };
      await POST(
        jsonRequest("https://radar.test/api/items/42/feedback", {
          vote: 1,
          reason: "alice"
        }),
        params("42")
      );
      users.current = { id: 8, role: "viewer" };
      const response = await POST(
        jsonRequest("https://radar.test/api/items/42/feedback", {
          vote: -1,
          reason: "bob"
        }),
        params("42")
      );

      expect(response.status).toBe(200);
      expect([...dbState.feedbacks.values()]).toEqual([
        { id: 1, itemId: 42, userId: 7, vote: 1, reason: "alice" },
        { id: 2, itemId: 42, userId: 8, vote: -1, reason: "bob" }
      ]);
    });
  });
});
