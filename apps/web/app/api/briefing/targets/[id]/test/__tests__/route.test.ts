/**
 * Real route tests for POST /api/briefing/targets/[id]/test
 * Imports the route handler directly (not a mirrored payload contract).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockGetRequestUser = vi.fn();

vi.mock("@fe-radar/db", () => ({
  getDb: () => ({ select: mockSelect }),
  briefingTargets: {
    id: "id",
    webhookUrl: "webhook_url",
    signSecret: "sign_secret",
    disabledAt: "disabled_at",
  },
  dailyPushConfig: { id: "id", baseUrl: "base_url" },
  dailyReports: { date: "date", sections: "sections" },
  commodityBriefings: {
    id: "id",
    briefingDate: "briefing_date",
    genStatus: "gen_status",
    payloadJson: "payload_json",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
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
  notFound: () =>
    Response.json({ error: { code: "NOT_FOUND", message: "不存在" } }, { status: 404 }),
}));

// Fixed "today" for content lookups (route uses dayjs().tz().format)
vi.mock("@fe-radar/shared", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  const realDayjs = mod.dayjs as (...args: unknown[]) => unknown;
  const stub = (...args: unknown[]) => {
    if (args.length === 0) {
      return { tz: () => ({ format: () => "2026-08-06" }) };
    }
    return realDayjs(...args);
  };
  Object.assign(stub, realDayjs);
  return {
    ...mod,
    dayjs: stub,
    APP_TIMEZONE: "Asia/Shanghai",
  };
});

import { POST } from "../route";

const SECRET_WEBHOOK =
  "https://oapi.dingtalk.com/robot/send?access_token=REAL_TOKEN_SHOULD_NOT_LEAK";
const SECRET = "SEC_real_secret_value";

const dailySections = {
  policy: "政策要点",
  market: "市场要点",
  tech: "",
  project: "",
  company: "",
};

const briefingPayload = {
  cu: { outlook: { trend: "偏多" } },
  lc: { outlook: { trend: "区间震荡" } },
  macro_summary: "宏观偏暖",
  procurement_advice: "刚需补库",
};

function chainSelect(result: unknown) {
  // Thenable at every step: target lookup ends at .where() without .limit().
  const chain: Record<string, unknown> = {};
  const asPromise = Promise.resolve(result);
  chain.then = asPromise.then.bind(asPromise);
  chain.catch = asPromise.catch.bind(asPromise);
  chain.finally = asPromise.finally.bind(asPromise);
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(result);
  return chain;
}

function setupSelectSequence(results: unknown[]) {
  let i = 0;
  mockSelect.mockImplementation(() => chainSelect(results[i++] ?? []));
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function req(): Request {
  return new Request("http://localhost/api/briefing/targets/1/test", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("POST /api/briefing/targets/[id]/test — auth", () => {
  it("returns 401 for unauthenticated", async () => {
    mockGetRequestUser.mockResolvedValue({ role: null });
    const res = await POST(req() as never, ctx("1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    mockGetRequestUser.mockResolvedValue({ role: "viewer", id: 2 });
    const res = await POST(req() as never, ctx("1"));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/briefing/targets/[id]/test — content + ActionCard", () => {
  beforeEach(() => {
    mockGetRequestUser.mockResolvedValue({ role: "admin", id: 1 });
  });

  it("returns 422 when neither daily nor pushable briefing exists", async () => {
    setupSelectSequence([
      [{ id: 1, webhookUrl: SECRET_WEBHOOK, signSecret: null, disabledAt: null }],
      [{ baseUrl: "http://fe-radar.internal" }],
      [], // daily
      [{ id: 9, genStatus: "failed", payloadJson: {} }],
    ]);
    const res = await POST(req() as never, ctx("1"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(JSON.stringify(body)).not.toContain("REAL_TOKEN");
    expect(JSON.stringify(body)).not.toContain("access_token");
  });

  it("sends daily-only ActionCard with signed webhook when secret present", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    setupSelectSequence([
      [{ id: 1, webhookUrl: SECRET_WEBHOOK, signSecret: SECRET, disabledAt: null }],
      [{ baseUrl: "http://fe-radar.internal" }],
      [{ sections: dailySections }],
      [], // no briefing
    ]);

    const res = await POST(req() as never, ctx("1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.card.btnTitles).toEqual(["查看产业日报"]);
    expect(body.card.actionPaths[0]).toContain("/daily?date=2026-08-06");
    expect(JSON.stringify(body)).not.toContain("REAL_TOKEN");
    expect(JSON.stringify(body)).not.toContain(SECRET);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain("timestamp=");
    expect(calledUrl).toContain("sign=");
    expect(calledUrl).toContain("access_token="); // outbound to DingTalk may use real URL
    // but response to client must not echo secrets — already checked above

    const payload = JSON.parse(init.body as string) as {
      msgtype: string;
      actionCard: {
        title: string;
        text: string;
        btns: Array<{ title: string; actionURL: string }>;
      };
    };
    expect(payload.msgtype).toBe("actionCard");
    expect(payload.actionCard.btns).toHaveLength(1);
    expect(payload.actionCard.btns[0]?.title).toBe("查看产业日报");
    expect(payload.actionCard.text).toContain("政策");
  });

  it("sends briefing-only ActionCard without signing when secret is null", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    setupSelectSequence([
      [{ id: 2, webhookUrl: SECRET_WEBHOOK, signSecret: null, disabledAt: null }],
      [{ baseUrl: "http://fe-radar.internal" }],
      [], // no daily
      [{ id: 42, genStatus: "degraded", payloadJson: briefingPayload }],
    ]);

    const res = await POST(req() as never, ctx("2"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.card.btnTitles).toEqual(["查看铜锂行情简报"]);
    expect(body.card.actionPaths[0]).toBe("/briefing/42");
    expect(JSON.stringify(body)).not.toContain("REAL_TOKEN");

    const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    // No sign when secret null
    expect(calledUrl).toBe(SECRET_WEBHOOK);
    expect(calledUrl).not.toContain("timestamp=");
    expect(calledUrl).not.toContain("&sign=");

    const payload = JSON.parse(init.body as string) as {
      msgtype: string;
      actionCard: { btns: Array<{ title: string; actionURL: string }> };
    };
    expect(payload.msgtype).toBe("actionCard");
    expect(payload.actionCard.btns).toHaveLength(1);
    expect(payload.actionCard.btns[0]?.actionURL).toContain("/briefing/42");
  });

  it("sends merged ActionCard when both daily and briefing present", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    setupSelectSequence([
      [{ id: 3, webhookUrl: SECRET_WEBHOOK, signSecret: SECRET, disabledAt: null }],
      [{ baseUrl: "https://fe-radar.internal/" }],
      [{ sections: dailySections }],
      [{ id: 7, genStatus: "succeeded", payloadJson: briefingPayload }],
    ]);

    const res = await POST(req() as never, ctx("3"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.card.btnTitles).toEqual(["查看产业日报", "查看铜锂行情简报"]);
    expect(body.card.title).toContain("合并日报");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as {
      actionCard: { btns: Array<{ title: string; actionURL: string }> };
    };
    expect(payload.actionCard.btns).toHaveLength(2);
  });

  it("returns 502 on DingTalk errcode without leaking webhook/secret", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errcode: 310000, errmsg: "sign not match" }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    setupSelectSequence([
      [{ id: 1, webhookUrl: SECRET_WEBHOOK, signSecret: SECRET, disabledAt: null }],
      [{ baseUrl: "http://fe-radar.internal" }],
      [{ sections: dailySections }],
      [],
    ]);

    const res = await POST(req() as never, ctx("1"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("sign not match");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("REAL_TOKEN");
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("access_token=REAL");
  });
});
