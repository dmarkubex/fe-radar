import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockGetRequestUser = vi.fn();
const mockQueueAdd = vi.fn();
const mockConnectionQuit = vi.fn().mockResolvedValue(undefined);

vi.mock("@fe-radar/db", () => ({
  getDb: () => ({
    select: mockSelect,
  }),
  dailyReports: { date: "date", sections: "sections" },
  dailyPushConfig: { id: "id", scheduleMode: "schedule_mode" },
  briefingHolidays: { holidayDate: "holiday_date" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
}));

vi.mock("@fe-radar/core", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    // hasDailyContent from real module; isBusinessDay controlled below
    isBusinessDay: vi.fn((date: string, holidays: Set<string>) => {
      if (holidays.has(date)) return false;
      const d = new Date(`${date}T00:00:00Z`);
      const day = d.getUTCDay();
      return day !== 0 && day !== 6;
    }),
  };
});

vi.mock("@/lib/api/authz", () => ({
  getRequestUser: (...args: unknown[]) => mockGetRequestUser(...args),
  requireFreshRole: async (...args: unknown[]) => {
    const user = await mockGetRequestUser(...args);
    if (!user.role) {
      return Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
    }
    if (user.role !== "admin") {
      return Response.json({ error: { code: "FORBIDDEN", message: "权限不足" } }, { status: 403 });
    }
    return null;
  },
}));

vi.mock("@/lib/auth/rbac", () => ({
  hasRole: (role: string, required: string) => role === required || role === "admin",
}));

vi.mock("bullmq", () => ({
  Queue: class {
    add = mockQueueAdd;
  },
}));

vi.mock("ioredis", () => ({
  default: class {
    quit = mockConnectionQuit;
  },
}));

import { POST } from "../route";

const sections = {
  policy: "政策",
  market: "市场",
  tech: "技术",
  project: "项目",
  company: "公司",
};

function chainSelect(result: unknown) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(result);
  // holidays select has no limit — make chain thenable
  const asPromise = Promise.resolve(result);
  chain.then = asPromise.then.bind(asPromise);
  chain.catch = asPromise.catch.bind(asPromise);
  chain.finally = asPromise.finally.bind(asPromise);
  return chain;
}

function setupSelectSequence(results: unknown[]) {
  let i = 0;
  mockSelect.mockImplementation(() => chainSelect(results[i++] ?? []));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQueueAdd.mockResolvedValue({ id: "job-1" });
  mockConnectionQuit.mockResolvedValue(undefined);
  mockGetRequestUser.mockResolvedValue({ role: "admin", id: "u1" });
});

function makeRequest(): Request {
  return new Request("http://localhost/api/briefing/daily/2026-08-03/repush", {
    method: "POST",
  });
}

function ctx(reportDate: string) {
  return { params: Promise.resolve({ reportDate }) };
}

describe("POST /api/briefing/daily/[reportDate]/repush", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetRequestUser.mockResolvedValue({ role: null });
    const res = await POST(makeRequest() as never, ctx("2026-08-03"));
    expect(res.status).toBe(401);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 403 when not admin", async () => {
    mockGetRequestUser.mockResolvedValue({ role: "viewer" });
    const res = await POST(makeRequest() as never, ctx("2026-08-03"));
    expect(res.status).toBe(403);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed reportDate", async () => {
    const res = await POST(makeRequest() as never, ctx("2026-8-3"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_REPORT_DATE");
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 400 for non-calendar date (2026-02-30)", async () => {
    const res = await POST(makeRequest() as never, ctx("2026-02-30"));
    expect(res.status).toBe(400);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 404 when report missing / empty content", async () => {
    setupSelectSequence([[]]); // no daily row
    const res = await POST(makeRequest() as never, ctx("2026-08-03"));
    expect(res.status).toBe(404);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 404 when sections are empty {}", async () => {
    setupSelectSequence([[{ date: "2026-08-03", sections: {} }]]);
    const res = await POST(makeRequest() as never, ctx("2026-08-03"));
    expect(res.status).toBe(404);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 422 REPORT_DATE_NOT_BUSINESS_DAY on holiday under business_days", async () => {
    // 2026-08-08 is Saturday; also listed in holidays for clarity
    setupSelectSequence([
      [{ date: "2026-08-08", sections }],
      [{ scheduleMode: "business_days" }],
      [{ holidayDate: "2026-08-08" }],
    ]);
    const res = await POST(makeRequest() as never, ctx("2026-08-08"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("REPORT_DATE_NOT_BUSINESS_DAY");
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 202 and enqueues daily-repush with explicit kind on success", async () => {
    setupSelectSequence([
      [{ date: "2026-08-03", sections }],
      [{ scheduleMode: "daily" }],
    ]);
    const res = await POST(makeRequest() as never, ctx("2026-08-03"));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ ok: true, reportDate: "2026-08-03" });
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    const [name, payload] = mockQueueAdd.mock.calls[0]!;
    expect(name).toBe("daily-repush");
    expect(payload).toEqual({
      kind: "daily-repush",
      reportDate: "2026-08-03",
      trigger: "manual",
    });
    expect(mockConnectionQuit).toHaveBeenCalled();
  });

  it("duplicate admin calls each enqueue (DB claim is the idempotency layer)", async () => {
    setupSelectSequence([
      [{ date: "2026-08-03", sections }],
      [{ scheduleMode: "daily" }],
      [{ date: "2026-08-03", sections }],
      [{ scheduleMode: "daily" }],
    ]);
    const r1 = await POST(makeRequest() as never, ctx("2026-08-03"));
    const r2 = await POST(makeRequest() as never, ctx("2026-08-03"));
    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);
    expect(mockQueueAdd).toHaveBeenCalledTimes(2);
  });
});
