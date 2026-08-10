import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

import type { NextRequest } from "next/server";

// S3b: requireFreshViewer → real verifyTokenFreshness needs a users row.
// Keep diagnostics queryResults separate from the freshness PK lookup.
const { mockGetDb, mockGetRequestUser, queryResults, freshnessRow } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockGetRequestUser: vi.fn(),
  queryResults: [] as unknown[][],
  freshnessRow: {
    current: {
      disabledAt: null as Date | null,
      role: "viewer",
      tokenVersion: 1
    }
  }
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  sql: vi.fn(() => ({}))
}));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  // Distinct markers so select().from(users) does not consume diagnostics queryResults.
  users: {
    id: "users.id",
    role: "users.role",
    disabledAt: "users.disabledAt",
    tokenVersion: "users.tokenVersion"
  },
  briefingHolidays: { holidayDate: "holidayDate", name: "name" },
  commodityBriefings: {
    briefingDate: "briefingDate",
    genStatus: "genStatus",
    genError: "genError",
    generatedAt: "generatedAt",
    id: "id"
  },
  commodityQuotes: {
    metricKey: "metricKey",
    observedAt: "observedAt",
    value: "value",
    changePct: "changePct"
  },
  sources: { fetcherType: "fetcherType", enabled: "enabled" }
}));

vi.mock("@/lib/api/authz", () => ({ getRequestUser: mockGetRequestUser }));

import { GET } from "../route";

type MockQueryMethod = (...args: unknown[]) => MockQuery;

interface MockQuery extends PromiseLike<unknown[]> {
  from: MockQueryMethod;
  where: MockQueryMethod;
  orderBy: MockQueryMethod;
  limit: MockQueryMethod;
}

const BASE = "http://localhost/api/quotes/latest";
const req = (url: string): NextRequest => ({ url }) as unknown as NextRequest;

function createQuery(rows: unknown[]): MockQuery {
  const promise = Promise.resolve(rows);
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => query),
    then: promise.then.bind(promise) as PromiseLike<unknown[]>["then"]
  };
  return query;
}

function isUsersTable(table: unknown): boolean {
  return (
    typeof table === "object" &&
    table !== null &&
    "tokenVersion" in table &&
    (table as { tokenVersion?: string }).tokenVersion === "users.tokenVersion"
  );
}

function setQueryResults(results: unknown[][]): void {
  queryResults.splice(0, queryResults.length, ...results);
}

beforeEach(() => {
  vi.clearAllMocks();
  queryResults.length = 0;
  // Active in-session user (S3b: tokenVersion required for requireFreshViewer).
  mockGetRequestUser.mockResolvedValue({ id: 1, role: "viewer", tokenVersion: 1 });
  freshnessRow.current = { disabledAt: null, role: "viewer", tokenVersion: 1 };
  mockGetDb.mockReturnValue({
    select: vi.fn(() => ({
      from: (table: unknown) => {
        if (isUsersTable(table)) {
          return {
            where: () => ({
              limit: async () => [freshnessRow.current]
            })
          };
        }
        const rows = queryResults.shift();
        if (!rows) {
          throw new Error("missing mocked query result");
        }
        return createQuery(rows);
      }
    }))
  });
});

describe("GET /api/quotes/latest diagnostics", () => {
  it("reports disabled quotes sources instead of a generic empty chart", async () => {
    setQueryResults([
      [],
      [],
      [{ value: 0 }],
      [],
      [{ total: 0, nonNull: 0 }],
      []
    ]);

    const response = await GET(req(`${BASE}?metric_key=cu_main_close&days=7`));
    const body = (await response.json()) as {
      diagnostics: {
        code: string;
        enabledQuotesSources: number;
        message: string;
      };
    };

    expect(response.status).toBe(200);
    expect(body.diagnostics.code).toBe("no_enabled_quotes_source");
    expect(body.diagnostics.enabledQuotesSources).toBe(0);
    expect(body.diagnostics.message).toContain("不会自动启用信源");
  });

  it("reports failed generation when quote data already exists", async () => {
    const today = dayjs().tz(APP_TIMEZONE).format("YYYY-MM-DD");
    const observedAt = new Date("2026-06-18T08:00:00.000Z");
    setQueryResults([
      [{ observedAt, value: "78000", changePct: "0.01" }],
      [{ observedAt, value: "78000" }],
      [{ value: 1 }],
      [],
      [{ total: 2, nonNull: 2 }],
      [
        {
          briefingDate: today,
          genStatus: "failed",
          genError: "kimi timeout",
          generatedAt: observedAt
        }
      ]
    ]);

    const response = await GET(req(`${BASE}?metric_key=cu_main_close&days=7`));
    const body = (await response.json()) as {
      items: unknown[];
      diagnostics: {
        code: string;
        generationFailedWithData: boolean;
        failedBriefingQuotes: { nonNull: number } | null;
        latestBriefing: { genError: string | null } | null;
      };
    };

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.diagnostics.code).toBe("generation_failed_with_data");
    expect(body.diagnostics.generationFailedWithData).toBe(true);
    expect(body.diagnostics.failedBriefingQuotes?.nonNull).toBe(2);
    expect(body.diagnostics.latestBriefing?.genError).toBe("kimi timeout");
  });
});
