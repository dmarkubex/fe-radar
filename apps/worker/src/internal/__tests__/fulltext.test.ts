import type http from "node:http";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FeRadarCore from "@fe-radar/core";
import type * as FeRadarShared from "@fe-radar/shared";

const mocks = vi.hoisted(() => {
  const fetchTextWithPolicy = vi.fn();
  const assertPublicFetchUrl = vi.fn();
  const assertRobotsAllowed = vi.fn();
  const waitHostGapForUrl = vi.fn();
  const getOrCreatePlaywrightPool = vi.fn();
  const acquireUserAgent = vi.fn(() => "UA-test");
  const proxyAcquire = vi.fn(() => undefined);
  const proxyRelease = vi.fn();
  const getDb = vi.fn();
  const eqFn = vi.fn((a: unknown, b: unknown) => ({ a, b }));
  const andFn = vi.fn((...args: unknown[]) => ({ and: args }));
  const sqlFn = (strings: unknown, ...values: unknown[]) => ({
    sql: Array.isArray(strings) ? strings.join("") : "raw",
    args: values
  });
  return {
    fetchTextWithPolicy,
    assertPublicFetchUrl,
    assertRobotsAllowed,
    waitHostGapForUrl,
    getOrCreatePlaywrightPool,
    acquireUserAgent,
    proxyAcquire,
    proxyRelease,
    getDb,
    eqFn,
    andFn,
    sqlFn
  };
});

vi.mock("../../fetchers/http", () => ({
  fetchTextWithPolicy: mocks.fetchTextWithPolicy
}));

vi.mock("../../lib/robots", () => ({
  assertRobotsAllowed: mocks.assertRobotsAllowed
}));

vi.mock("../../lib/ua-pool", () => ({
  acquireUserAgent: mocks.acquireUserAgent
}));

vi.mock("../../lib/proxy-pool", () => ({
  proxyPool: {
    acquire: mocks.proxyAcquire,
    release: mocks.proxyRelease
  }
}));

vi.mock("../../lib/playwright-pool", () => ({
  getOrCreatePlaywrightPool: mocks.getOrCreatePlaywrightPool
}));

vi.mock("@fe-radar/db", () => {
  const items = { id: "items.id", content: "items.content" };
  const itemAnalysis = { itemId: "item_analysis.item_id", summaryZh: "item_analysis.summary_zh" };
  const copilotItemFulltext = {
    itemId: "copilot.item_fulltext.item_id",
    content: "copilot.item_fulltext.content",
    truncated: "copilot.item_fulltext.truncated",
    fetchedAt: "copilot.item_fulltext.fetched_at"
  };
  return {
    getDb: mocks.getDb,
    items,
    itemAnalysis,
    copilotItemFulltext
  };
});

vi.mock("drizzle-orm", () => ({
  eq: mocks.eqFn,
  and: mocks.andFn,
  sql: mocks.sqlFn
}));

vi.mock("@fe-radar/core", async (importOriginal) => {
  const actual = await importOriginal<typeof FeRadarCore>();
  return {
    ...actual,
    assertPublicFetchUrl: mocks.assertPublicFetchUrl,
    waitHostGapForUrl: mocks.waitHostGapForUrl
  };
});

vi.mock("@fe-radar/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof FeRadarShared>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  };
});

import { firstExecuteRow, runDetailFetch, runFulltextRequest } from "../fulltext";
import { SourceFetchError } from "@fe-radar/shared";

interface FakeDb {
  execute: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function makeDb(opts: {
  visible: Array<Record<string, unknown>>;
  stored?: Array<{ content: string; truncated: boolean }>;
}): FakeDb {
  // drizzle-orm/postgres-js execute 返回 RowList（Array 子类）。测试钉死数组形状。
  const execute = vi.fn().mockResolvedValue(opts.visible);
  const selectLimit = vi.fn().mockResolvedValue(opts.stored ?? []);
  const selectFrom = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: selectLimit }) });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  const insertValues = vi.fn().mockReturnValue({
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined)
  });
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  return { execute, select, insert, update };
}

interface FakeRes {
  statusCode: number;
  headersSent: boolean;
  setHeader: (k: string, v: string) => FakeRes;
  getHeader: (k: string) => string | undefined;
  write: (chunk: string) => boolean;
  emit: (event: string) => boolean;
  end: (chunk?: unknown) => FakeRes;
  body: string;
  headers: Record<string, string>;
}

function asRes(res: FakeRes): http.ServerResponse {
  return res as unknown as http.ServerResponse;
}

function makeRes(): FakeRes {
  const writable = new PassThrough() as unknown as FakeRes;
  writable.body = "";
  writable.headers = {};
  let status = 0;
  let sent = false;
  Object.defineProperty(writable, "statusCode", {
    get() { return status; },
    set(v: number) { status = v; }
  });
  Object.defineProperty(writable, "headersSent", { get: () => sent });
  writable.setHeader = (k: string, v: string): FakeRes => {
    writable.headers[k.toLowerCase()] = v;
    return writable;
  };
  writable.getHeader = (k: string): string | undefined =>
    writable.headers[k.toLowerCase()];
  writable.end = (chunk?: unknown): FakeRes => {
    if (chunk !== undefined) {
      const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      writable.body += text;
      writable.write(text);
    }
    sent = true;
    writable.emit("finish");
    return writable;
  };
  return writable;
}

const visibleRow = {
  id: 42,
  title: "测试条目",
  url: "https://example.com/news/42",
  summary_zh: "摘要",
  scored_at: new Date("2026-08-20T00:00:00Z"),
  source_name: "Example Source",
  fetcher_type: "html"
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertPublicFetchUrl.mockResolvedValue({ allowed: true, reason: "OK" });
  mocks.assertRobotsAllowed.mockResolvedValue(undefined);
  mocks.waitHostGapForUrl.mockResolvedValue(undefined);
  mocks.fetchTextWithPolicy.mockResolvedValue(
    `<html><body><article>${"x".repeat(200)}</article></body></html>`
  );
  mocks.getOrCreatePlaywrightPool.mockRejectedValue(
    new Error("pool unavailable in test")
  );
});

describe("firstExecuteRow (postgres-js / drizzle execute)", () => {
  it("returns undefined for 0-row array", () => {
    expect(firstExecuteRow([])).toBeUndefined();
  });

  it("returns index 0 for 1-row array", () => {
    const row = { id: 7, url: "https://example.com/7" };
    expect(firstExecuteRow([row])).toEqual(row);
  });
});

describe("runFulltextRequest", () => {
  it("returns 400 FULLTEXT_URL_FORBIDDEN when body carries url/href", async () => {
    const res = makeRes();
    await runFulltextRequest({} as http.IncomingMessage, asRes(res), { itemId: 1, url: "https://x" }, "c-1");
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("FULLTEXT_URL_FORBIDDEN");
  });

  it("returns 404 NOT_VISIBLE when visible_items has 0 rows", async () => {
    const db = makeDb({ visible: [] });
    mocks.getDb.mockReturnValue(db);
    const res = makeRes();
    await runFulltextRequest({} as http.IncomingMessage, asRes(res), { itemId: 99 }, "c-99");
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("NOT_VISIBLE");
  });

  it("returns HTTP 200 {ok:false,reason:SSRF} not 403 when allowed=false", async () => {
    const db = makeDb({ visible: [visibleRow] });
    mocks.getDb.mockReturnValue(db);
    mocks.assertPublicFetchUrl.mockResolvedValue({ allowed: false, reason: "PRIVATE_IP" });
    const res = makeRes();
    await runFulltextRequest({} as http.IncomingMessage, asRes(res), { itemId: 42 }, "c-ssrf");
    expect(res.statusCode).toBe(200);
    expect(res.statusCode).not.toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, reason: "SSRF" });
  });

  it("returns HTTP 200 {ok:false,reason:ROBOTS_DISALLOWED} not 403", async () => {
    const db = makeDb({ visible: [visibleRow] });
    mocks.getDb.mockReturnValue(db);
    mocks.assertRobotsAllowed.mockRejectedValue(
      new SourceFetchError("ROBOTS_DISALLOWED", "robots disallow")
    );
    const res = makeRes();
    await runFulltextRequest({} as http.IncomingMessage, asRes(res), { itemId: 42 }, "c-robots");
    expect(res.statusCode).toBe(200);
    expect(res.statusCode).not.toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, reason: "ROBOTS_DISALLOWED" });
  });
});

describe("runDetailFetch", () => {
  it("returns SSRF reason when assertPublicFetchUrl.allowed is false (does not call fetchText)", async () => {
    const db = makeDb({ visible: [visibleRow] });
    mocks.getDb.mockReturnValue(db);
    mocks.assertPublicFetchUrl.mockResolvedValue({ allowed: false, reason: "PRIVATE_IP" });

    const result = await runDetailFetch(42);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("SSRF");
    expect(mocks.fetchTextWithPolicy).not.toHaveBeenCalled();
  });

  it("returns stored source when copilot.item_fulltext already has a row (no network)", async () => {
    const db = makeDb({
      visible: [visibleRow],
      stored: [{ content: "stored 正文", truncated: false }]
    });
    mocks.getDb.mockReturnValue(db);

    const result = await runDetailFetch(42);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("stored");
      expect(result.content).toBe("stored 正文");
    }
    expect(mocks.fetchTextWithPolicy).not.toHaveBeenCalled();
  });

  it("fetches and extracts when stored is empty; returns ok:true source:fetched", async () => {
    const db = makeDb({ visible: [visibleRow] });
    mocks.getDb.mockReturnValue(db);

    const result = await runDetailFetch(42);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("fetched");
      expect(result.content.length).toBeGreaterThanOrEqual(80);
      expect(result.itemId).toBe(42);
    }
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("returns EXTRACT_TOO_SHORT when fetch returns html shorter than 80 chars", async () => {
    const db = makeDb({ visible: [visibleRow] });
    mocks.getDb.mockReturnValue(db);
    mocks.fetchTextWithPolicy.mockResolvedValue("<html><body>tiny</body></html>");

    const result = await runDetailFetch(42);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("EXTRACT_TOO_SHORT");
  });

  it("PLAYWRIGHT path returns ROBOTS_DISALLOWED when assertRobotsAllowed throws", async () => {
    const db = makeDb({
      visible: [{ ...visibleRow, fetcher_type: "playwright" }]
    });
    mocks.getDb.mockReturnValue(db);
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("https://example.com/news/42"),
      content: vi.fn().mockResolvedValue(`<article>${"a".repeat(200)}</article>`),
      close: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined)
    };
    const context = { newPage: vi.fn().mockResolvedValue(page) };
    mocks.getOrCreatePlaywrightPool.mockResolvedValue({
      acquire: vi.fn().mockResolvedValue({ context, userAgent: "UA", proxy: undefined })
    });
    mocks.assertRobotsAllowed.mockRejectedValue(
      new SourceFetchError("ROBOTS_DISALLOWED", "robots disallow")
    );

    const result = await runDetailFetch(42);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ROBOTS_DISALLOWED");
  });

  it("PLAYWRIGHT fetcher_type with unavailable pool returns PLAYWRIGHT_UNAVAILABLE", async () => {
    const db = makeDb({
      visible: [{ ...visibleRow, fetcher_type: "playwright" }]
    });
    mocks.getDb.mockReturnValue(db);

    const result = await runDetailFetch(42);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("PLAYWRIGHT_UNAVAILABLE");
  });

  it("Playwright path: robots receives the pooled userAgent, not the requested one", async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("https://example.com/news/42"),
      content: vi.fn().mockResolvedValue(`<article>${"a".repeat(200)}</article>`),
      close: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined)
    };
    const context = { newPage: vi.fn().mockResolvedValue(page) };
    const pool = {
      acquire: vi.fn().mockResolvedValue({
        context,
        userAgent: "UA-from-pool",
        proxy: undefined
      })
    };
    mocks.getOrCreatePlaywrightPool.mockResolvedValue(pool);
    mocks.acquireUserAgent.mockReturnValue("UA-requested");

    const db = makeDb({
      visible: [{ ...visibleRow, fetcher_type: "playwright" }]
    });
    mocks.getDb.mockReturnValue(db);

    const result = await runDetailFetch(42);

    expect(result.ok).toBe(true);
    expect(mocks.assertRobotsAllowed).toHaveBeenCalledWith(
      "https://example.com/news/42",
      "UA-from-pool"
    );
    expect(mocks.assertRobotsAllowed).not.toHaveBeenCalledWith(
      "https://example.com/news/42",
      "UA-requested"
    );
    expect(page.close).toHaveBeenCalled();
    expect(mocks.proxyRelease).toHaveBeenCalled();
  });

  it("Playwright success path releases proxy with true (non-empty HTML)", async () => {
    const proxy = { id: "p1", server: "http://proxy.test:1", disabled: false, failCount: 0 };
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("https://example.com/news/42"),
      content: vi.fn().mockResolvedValue(`<article>${"a".repeat(200)}</article>`),
      close: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined)
    };
    const context = { newPage: vi.fn().mockResolvedValue(page) };
    mocks.getOrCreatePlaywrightPool.mockResolvedValue({
      acquire: vi.fn().mockResolvedValue({ context, userAgent: "UA", proxy })
    });
    mocks.proxyAcquire.mockReturnValue(proxy);

    const db = makeDb({
      visible: [{ ...visibleRow, fetcher_type: "playwright" }]
    });
    mocks.getDb.mockReturnValue(db);

    const result = await runDetailFetch(42);

    expect(result.ok).toBe(true);
    expect(mocks.proxyRelease).toHaveBeenCalledWith(proxy, true);
    expect(mocks.proxyRelease).not.toHaveBeenCalledWith(proxy, false);
  });

  it("Playwright path order: pool → acquire → robots(pooled UA) → waitHostGap → newPage → goto", async () => {
    const order: string[] = [];
    const page = {
      goto: vi.fn().mockImplementation(async () => {
        order.push("goto");
      }),
      url: vi.fn().mockReturnValue("https://example.com/news/42"),
      content: vi.fn().mockResolvedValue(`<article>${"a".repeat(200)}</article>`),
      close: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined)
    };
    const context = {
      newPage: vi.fn().mockImplementation(async () => {
        order.push("newPage");
        return page;
      })
    };
    const acquire = vi.fn().mockImplementation(async () => {
      order.push("acquire");
      return { context, userAgent: "UA-from-pool", proxy: undefined };
    });
    mocks.getOrCreatePlaywrightPool.mockImplementation(async () => {
      order.push("getOrCreatePlaywrightPool");
      return { acquire };
    });
    mocks.assertRobotsAllowed.mockImplementation(async () => {
      order.push("assertRobotsAllowed");
    });
    mocks.waitHostGapForUrl.mockImplementation(async () => {
      order.push("waitHostGapForUrl");
    });

    const db = makeDb({
      visible: [{ ...visibleRow, fetcher_type: "playwright" }]
    });
    mocks.getDb.mockReturnValue(db);

    const result = await runDetailFetch(42);

    expect(result.ok).toBe(true);
    expect(order).toEqual([
      "getOrCreatePlaywrightPool",
      "acquire",
      "assertRobotsAllowed",
      "waitHostGapForUrl",
      "newPage",
      "goto"
    ]);
    expect(mocks.waitHostGapForUrl).toHaveBeenCalledTimes(1);
  });

  it("Playwright path: finalUrl SSRF recheck fires (does not trust goto landing)", async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("http://127.0.0.1/redirected"),
      content: vi.fn().mockResolvedValue(`<article>${"a".repeat(200)}</article>`),
      close: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined)
    };
    const context = { newPage: vi.fn().mockResolvedValue(page) };
    const pool = {
      acquire: vi.fn().mockResolvedValue({
        context,
        userAgent: "UA-from-pool",
        proxy: undefined
      })
    };
    mocks.getOrCreatePlaywrightPool.mockResolvedValue(pool);

    mocks.assertPublicFetchUrl
      .mockResolvedValueOnce({ allowed: true, reason: "OK" })
      .mockResolvedValueOnce({ allowed: false, reason: "PRIVATE_IP" });

    const db = makeDb({
      visible: [{ ...visibleRow, fetcher_type: "playwright", url: "https://example.com/news/42" }]
    });
    mocks.getDb.mockReturnValue(db);

    const result = await runDetailFetch(42);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("SSRF");
    expect(page.content).not.toHaveBeenCalled();
  });

  it("Playwright path: content() rejection surfaces as FETCH_TIMEOUT (page still closed)", async () => {
    const fetchTimeoutErr = new SourceFetchError("FETCH_TIMEOUT", "page.content() race lost");
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("https://example.com/news/42"),
      content: vi.fn().mockRejectedValue(fetchTimeoutErr),
      close: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined)
    };
    const context = { newPage: vi.fn().mockResolvedValue(page) };
    const pool = {
      acquire: vi.fn().mockResolvedValue({
        context,
        userAgent: "UA",
        proxy: undefined
      })
    };
    mocks.getOrCreatePlaywrightPool.mockResolvedValue(pool);

    const db = makeDb({
      visible: [{ ...visibleRow, fetcher_type: "playwright" }]
    });
    mocks.getDb.mockReturnValue(db);

    const result = await runDetailFetch(42);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("FETCH_TIMEOUT");
    expect(page.close).toHaveBeenCalled();
  });

  it("items.content backfill where clause uses IS NULL / '' / summary_zh (no length threshold)", async () => {
    const db = makeDb({ visible: [visibleRow] });
    mocks.getDb.mockReturnValue(db);
    mocks.andFn.mockClear();

    await runDetailFetch(42);

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(mocks.andFn).toHaveBeenCalled();
    // andFn(...args) → { and: args } captures the SQL raw as the second arg
    // (after eq(items.id, 42)). The SQL raw is `{ sql: "...", args: [...] }`.
    const firstCallArgs = mocks.andFn.mock.calls[0] ?? [];
    // Find the sql raw fragment in any arg position; it has shape `{ sql: "..." }`.
    const sqlFragment = firstCallArgs.find(
      (a) => a && typeof a === "object" && "sql" in a
    ) as { sql: string } | undefined;
    expect(sqlFragment?.sql).toContain("IS NULL");
    expect(sqlFragment?.sql).toContain("= ''");
    expect(sqlFragment?.sql).toContain("summary_zh");
    expect(sqlFragment?.sql).not.toMatch(/char_length|length\(.*content/);
  });
});