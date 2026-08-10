import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockGetRequestUser = vi.fn();

vi.mock("@fe-radar/db", () => ({
  getDb: () => ({
    select: mockSelect,
    update: mockUpdate,
  }),
  dailyPushConfig: {
    id: "id",
    enabled: "enabled",
    sendTime: "send_time",
    scheduleMode: "schedule_mode",
    baseUrl: "base_url",
    updatedBy: "updated_by",
    updatedAt: "updated_at",
  },
  dailyPushes: {
    id: "id",
    reportDate: "report_date",
    targetId: "target_id",
    briefingId: "briefing_id",
    dailyReportPresent: "daily_report_present",
    briefingPresent: "briefing_present",
    pushStatus: "push_status",
    attemptCount: "attempt_count",
    errorDetail: "error_detail",
    pushedAt: "pushed_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  desc: vi.fn(() => "desc"),
}));

vi.mock("@/lib/api/authz", () => ({
  getRequestUser: (...args: unknown[]) => mockGetRequestUser(...args),
  // T-SEC-06: route 改用 requireFreshRole（内部 = requireRequestRole + token 新鲜度）。
  // mock 语义与真实实现一致：无 role 401、非 admin 403、否则放行。
  requireFreshRole: async (...args: unknown[]) => {
    const user = await mockGetRequestUser(...args);
    if (!user.role) return Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: { code: "FORBIDDEN", message: "权限不足" } }, { status: 403 });
    return null;
  },
  unauthorized: () =>
    Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 }),
  forbidden: () =>
    Response.json({ error: { code: "FORBIDDEN", message: "权限不足" } }, { status: 403 }),
}));

import { GET, PUT } from "../route";
import { scheduleConfigSchema } from "../../../../../lib/api/briefing-schema";

function chainSelect(result: unknown) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(result);
  return chain;
}

function chainUpdate(result: unknown) {
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(result);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("scheduleConfigSchema", () => {
  it("accepts valid schedule and strips trailing slash", () => {
    const result = scheduleConfigSchema.safeParse({
      enabled: true,
      sendTime: "16:15",
      scheduleMode: "business_days",
      baseUrl: "http://fe-radar.internal/",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseUrl).toBe("http://fe-radar.internal");
    }
  });

  it("rejects invalid sendTime", () => {
    expect(
      scheduleConfigSchema.safeParse({
        enabled: false,
        sendTime: "25:99",
        scheduleMode: "daily",
        baseUrl: "http://fe-radar.internal",
      }).success
    ).toBe(false);
  });

  it("rejects non-http(s) baseUrl", () => {
    expect(
      scheduleConfigSchema.safeParse({
        enabled: false,
        sendTime: "09:00",
        scheduleMode: "daily",
        baseUrl: "ftp://x",
      }).success
    ).toBe(false);
  });
});

describe("GET /api/briefing/schedule", () => {
  it("returns 401 for unauthenticated", async () => {
    mockGetRequestUser.mockResolvedValue({ role: null });
    const res = await GET({} as never);
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    mockGetRequestUser.mockResolvedValue({ role: "viewer", id: 1 });
    const res = await GET({} as never);
    expect(res.status).toBe(403);
  });

  it("returns config + recent pushes for admin", async () => {
    mockGetRequestUser.mockResolvedValue({ role: "admin", id: 9 });
    const config = {
      id: 1,
      enabled: false,
      sendTime: "16:15",
      scheduleMode: "business_days",
      baseUrl: "http://fe-radar.internal",
      updatedBy: null,
      updatedAt: new Date("2026-08-01T00:00:00Z"),
    };
    const pushes = [
      {
        id: 1,
        reportDate: "2026-08-01",
        targetId: 2,
        briefingId: null,
        dailyReportPresent: true,
        briefingPresent: false,
        pushStatus: "succeeded",
        attemptCount: 1,
        errorDetail: null,
        pushedAt: new Date("2026-08-01T08:15:00Z"),
      },
    ];
    let call = 0;
    mockSelect.mockImplementation(() => {
      call += 1;
      return chainSelect(call === 1 ? [config] : pushes);
    });

    const res = await GET({} as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.enabled).toBe(false);
    expect(body.timezone).toBe("Asia/Shanghai");
    expect(body.recentPushes).toHaveLength(1);
  });
});

describe("PUT /api/briefing/schedule", () => {
  it("returns 400 on validation failure", async () => {
    mockGetRequestUser.mockResolvedValue({ role: "admin", id: 1 });
    const req = {
      json: async () => ({
        enabled: true,
        sendTime: "bad",
        scheduleMode: "daily",
        baseUrl: "http://fe-radar.internal",
      }),
    };
    const res = await PUT(req as never);
    expect(res.status).toBe(400);
  });

  it("updates config for admin", async () => {
    mockGetRequestUser.mockResolvedValue({ role: "admin", id: 3 });
    const updated = {
      id: 1,
      enabled: true,
      sendTime: "17:00",
      scheduleMode: "daily",
      baseUrl: "https://fe-radar.example",
      updatedBy: 3,
      updatedAt: new Date("2026-08-06T00:00:00Z"),
    };
    mockUpdate.mockReturnValue(chainUpdate([updated]));

    const req = {
      json: async () => ({
        enabled: true,
        sendTime: "17:00",
        scheduleMode: "daily",
        baseUrl: "https://fe-radar.example/",
      }),
    };
    const res = await PUT(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.sendTime).toBe("17:00");
    expect(body.config.baseUrl).toBe("https://fe-radar.example");
  });
});
