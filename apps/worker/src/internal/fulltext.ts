/**
 * T-CA-05 / design §3.4 + §3.4.1: `POST /internal/fulltext` 的业务实现 + handler 出口。
 *
 * 关键不变量（必须遵守）：
 * - visible 0 行 → `{ok:false, reason:"NOT_VISIBLE"}`，HTTP 404。
 * - stored 命中（copilot.item_fulltext 有行）→ `source:"stored"`，立即返回。
 *   **禁止**用 `items.content` 长度短路。
 * - SSRF：检查 `assertPublicFetchUrl(...).allowed`，false 即 reason `SSRF`；
 *   Playwright 路径在 `page.url()` 后同样再检，allowed=false 且函数未抛也必须拦。
 * - Playwright 闸走显式 `waitHostGapForUrl`，不走 `playwright.ts` 的通用 goto
 *   包装（design §3.4.2 段尾明确）。
 * - DEADLINE_MS=20000：`remainingOrTimeout()` 入口≤200 抛 FETCH_TIMEOUT；
 *   `selTimeout = min(8000, remainingOrTimeout()-200)`，禁止把 r-200=0 传 Playwright。
 * - `items.content` 回填仅当 `IS NULL OR ='' OR =item_analysis.summary_zh`。
 *   **禁止任何长度阈值**，合法 40 字正文不得被覆写。
 */
import type http from "node:http";
import { SourceFetchError } from "@fe-radar/shared";
import { and, eq, sql } from "drizzle-orm";
import { assertPublicFetchUrl, waitHostGapForUrl } from "@fe-radar/core";
import { copilotItemFulltext, getDb, items as itemsTable } from "@fe-radar/db";

import { acquireUserAgent } from "../lib/ua-pool";
import { proxyPool } from "../lib/proxy-pool";
import { assertRobotsAllowed } from "../lib/robots";
import { fetchTextWithPolicy } from "../fetchers/http";
import { getOrCreatePlaywrightPool } from "../lib/playwright-pool";
import type { PageLike, PooledBrowserContext } from "../fetchers/playwright";

import { DETAIL_READY_SELECTOR, extractDetailPlainText, ExtractTooShortError } from "./article-text";

/** design §3.4.1 step 0：handler 入口起算的绝对预算。 */
export const DEADLINE_MS = 20000;

export type FulltextReason =
  | "EXTRACT_TOO_SHORT"
  | "FETCH_HOST_THROTTLED"
  | "FETCH_TIMEOUT"
  | "ROBOTS_DISALLOWED"
  | "SSRF"
  | "NOT_VISIBLE"
  | "PLAYWRIGHT_UNAVAILABLE";

export type FulltextSource = "stored" | "fetched";

export type FulltextResult =
  | {
      ok: true;
      itemId: number;
      content: string;
      truncated: boolean;
      source: FulltextSource;
      title: string | null;
      summaryZh: string | null;
      scoredAt: Date | null;
      sourceName: string | null;
    }
  | {
      ok: false;
      reason: FulltextReason;
    };

interface VisibleItemRow extends Record<string, unknown> {
  id: number;
  title: string | null;
  url: string;
  summary_zh: string | null;
  scored_at: Date | null;
  source_name: string | null;
  fetcher_type: string | null;
}

interface StoredFulltextRow {
  content: string;
  truncated: boolean;
}

/**
 * 把任意抛出的 SourceFetchError 映射到 reason。
 * 不在映射表里的 code 视为上游 bug，固定映射 FETCH_TIMEOUT（避免 5xx leak）。
 */
function mapFetchErrorToReason(err: unknown): FulltextReason {
  if (err instanceof ExtractTooShortError) return "EXTRACT_TOO_SHORT";
  if (err instanceof SourceFetchError) {
    switch (err.code) {
      case "FETCH_HOST_THROTTLED":
        return "FETCH_HOST_THROTTLED";
      case "ROBOTS_DISALLOWED":
        return "ROBOTS_DISALLOWED";
      case "FETCH_SSRF_BLOCKED":
        return "SSRF";
      case "FETCH_TIMEOUT":
      case "FETCH_HTTP_ERROR":
      case "FETCH_RESPONSE_TOO_LARGE":
      case "FETCH_PLAYWRIGHT_POOL":
      case "FETCH_PLAYWRIGHT_EMPTY":
        return "FETCH_TIMEOUT";
      default:
        return "FETCH_TIMEOUT";
    }
  }
  return "FETCH_TIMEOUT";
}

/**
 * 主入口：HTTP handler 与 detail-fetch job 共用。
 */
export async function runDetailFetch(itemId: number): Promise<FulltextResult> {
  const t0 = Date.now();
  const remainingMs = (): number => {
    const r = DEADLINE_MS - (Date.now() - t0);
    if (r <= 200) throw new SourceFetchError("FETCH_TIMEOUT", "fulltext deadline exhausted");
    return r;
  };
  const selTimeout = (): number => Math.min(8000, remainingMs() - 200);

  const db = getDb();

  // §3.4.1 step 1：visible_items 视图（0064）；禁止再手拼五谓词。
  // drizzle-orm/postgres-js 的 execute 返回 postgres-js RowList（Array 子类，可 [0]）。
  const visibleRows = await db.execute<VisibleItemRow>(sql`
    SELECT id, title, url, summary_zh, scored_at, source_name, fetcher_type
    FROM copilot.visible_items
    WHERE id = ${itemId}
    LIMIT 1
  `);
  const row = firstExecuteRow<VisibleItemRow>(visibleRows);
  if (!row) {
    return { ok: false, reason: "NOT_VISIBLE" };
  }

  // §3.4.1 step 2：copilot.item_fulltext 有行 → stored 命中。
  const storedRows = await db
    .select({
      content: copilotItemFulltext.content,
      truncated: copilotItemFulltext.truncated
    })
    .from(copilotItemFulltext)
    .where(eq(copilotItemFulltext.itemId, itemId))
    .limit(1);
  const stored: StoredFulltextRow | undefined = storedRows[0];
  if (stored) {
    return {
      ok: true,
      itemId,
      content: stored.content,
      truncated: stored.truncated,
      source: "stored",
      title: row.title,
      summaryZh: row.summary_zh,
      scoredAt: row.scored_at,
      sourceName: row.source_name
    };
  }

  // §3.4.1 step 3：SSRF 检查（不依赖 throw）。
  const guard = await assertPublicFetchUrl(row.url);
  if (!guard.allowed) {
    return { ok: false, reason: "SSRF" };
  }

  // §3.4.1 step 4 / 6：分路径抓取 + 抽取。
  let html: string;
  try {
    html = row.fetcher_type === "playwright"
      ? await fetchHtmlViaPlaywright(row.url, remainingMs, selTimeout)
      : await fetchHtmlViaHttp(row.url, remainingMs);
  } catch (err) {
    if (
      err instanceof SourceFetchError &&
      err.code === "FETCH_PLAYWRIGHT_POOL"
    ) {
      return { ok: false, reason: "PLAYWRIGHT_UNAVAILABLE" };
    }
    return { ok: false, reason: mapFetchErrorToReason(err) };
  }

  let extracted;
  try {
    extracted = extractDetailPlainText(html);
  } catch (err) {
    return { ok: false, reason: mapFetchErrorToReason(err) };
  }

  // §3.4.1 step 7：UPSERT item_fulltext + 条件回填 items.content。
  await persistFulltext(itemId, extracted);

  return {
    ok: true,
    itemId,
    content: extracted.content,
    truncated: extracted.truncated,
    source: "fetched",
    title: row.title,
    summaryZh: row.summary_zh,
    scoredAt: row.scored_at,
    sourceName: row.source_name
  };
}

/**
 * `POST /internal/fulltext` HTTP handler。
 *
 * - 401/400 由 `http-server.ts` 处理；这里只管业务。
 * - 成功 200 `FulltextResult`（无论 ok:true 或 ok:false，**不**回 403）。
 * - 唯一 404 路径：`NOT_VISIBLE`（视图 0 行，design §3.4 写死）。
 * - 其它失败（超时 / SSRF / robots / 抽取 / 闸 / playwright 不可用）→ 200 `{ok:false,reason}`。
 */
export async function runFulltextRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: unknown,
  _correlationId: string
): Promise<void> {
  const validation = validateFulltextBody(body);
  if (!validation.ok) {
    sendJson(res, 400, { error: { code: validation.errorCode } });
    return;
  }

  const result = await runDetailFetch(validation.itemId);
  if (!result.ok && result.reason === "NOT_VISIBLE") {
    sendJson(res, 404, { error: { code: "NOT_VISIBLE" } });
    return;
  }
  sendJson(res, 200, result);
}

function validateFulltextBody(body: unknown):
  | { ok: true; itemId: number }
  | { ok: false; errorCode: string } {
  if (body === null || typeof body !== "object") {
    return { ok: false, errorCode: "INVALID_BODY" };
  }
  const obj = body as Record<string, unknown>;
  // 禁止 url/href 字段：copilot_app 不能直接传 URL，URL 必须从 DB 取（避免绕过可见性）。
  if ("url" in obj || "href" in obj) {
    return { ok: false, errorCode: "FULLTEXT_URL_FORBIDDEN" };
  }
  const itemId = obj.itemId;
  if (typeof itemId !== "number" || !Number.isFinite(itemId) || itemId <= 0) {
    return { ok: false, errorCode: "INVALID_ITEM_ID" };
  }
  return { ok: true, itemId };
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

/**
 * postgres-js / drizzle `execute` 结果：RowList 是 Array 子类，可按下标取行。
 * 0 行 → undefined；禁止 `Array.from(result as Iterable)`（Iterable-only 假对象会误过测试）。
 */
export function firstExecuteRow<T>(result: unknown): T | undefined {
  if (!Array.isArray(result) || result.length === 0) {
    return undefined;
  }
  return result[0] as T;
}

async function fetchHtmlViaHttp(
  url: string,
  remainingMs: () => number
): Promise<string> {
  // §3.4.1 step 5：HTTP 路径先 robots，再 fetchTextWithPolicy（闸在 IN① 内部）。
  await assertRobotsAllowed(url, acquireUserAgent(true));
  return await fetchTextWithPolicy(url, {
    timeoutMs: Math.min(15000, remainingMs()),
    deadlineMs: remainingMs(),
    maxResponseBytes: 512_000,
    useRealUa: true
  });
}

async function fetchHtmlViaPlaywright(
  url: string,
  remainingMs: () => number,
  selTimeout: () => number
): Promise<string> {
  // §3.4.1 step 4：pool → acquire → robots(pooled.UA) → 闸 → newPage → goto。
  // 闸只打这一次；goto 前不再第二次 waitHostGapForUrl。
  const pool = await getOrCreatePlaywrightPool().catch((err: unknown) => {
    throw new SourceFetchError(
      "FETCH_PLAYWRIGHT_POOL",
      `playwright pool unavailable: ${err instanceof Error ? err.message : String(err)}`,
      { url }
    );
  });

  const requestedUserAgent = acquireUserAgent(true);
  const requestedProxy = proxyPool.acquire();
  let pooled: PooledBrowserContext | null = null;
  let page: PageLike | null = null;
  let html = "";
  try {
    pooled = await pool.acquire(requestedUserAgent, requestedProxy);
    await assertRobotsAllowed(url, pooled.userAgent);
    await waitHostGapForUrl(url, { waitMaxMs: Math.min(8000, remainingMs() - 200) });

    page = await pooled.context.newPage();
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(15000, remainingMs())
    });
    const finalUrl = page.url();
    const finalGuard = await assertPublicFetchUrl(finalUrl);
    if (!finalGuard.allowed) {
      throw new SourceFetchError(
        "FETCH_SSRF_BLOCKED",
        `Playwright final URL blocked: ${finalGuard.reason}`,
        { url: finalUrl }
      );
    }
    try {
      await page.waitForSelector(DETAIL_READY_SELECTOR, { timeout: selTimeout() });
    } catch (err) {
      if (
        !(err instanceof Error) ||
        !/timeout|timed out|exceeded/i.test(err.message)
      ) {
        throw err;
      }
    }
    const remaining = remainingMs();
    html = await Promise.race([
      page.content(),
      new Promise<string>((_, reject) =>
        setTimeout(
          () =>
            reject(new SourceFetchError("FETCH_TIMEOUT", "page.content() race lost", { url })),
          remaining
        )
      )
    ]);
    return html;
  } finally {
    try {
      await page?.close();
    } catch {
      // best-effort close
    }
    if (pooled) {
      proxyPool.release(pooled.proxy, !html);
    }
  }
}

/**
 * UPSERT `copilot.item_fulltext` + 条件回填 `items.content`。
 */
async function persistFulltext(
  itemId: number,
  extracted: { content: string; truncated: boolean }
): Promise<void> {
  const db = getDb();
  await db
    .insert(copilotItemFulltext)
    .values({
      itemId,
      content: extracted.content,
      truncated: extracted.truncated,
      fetchedAt: new Date()
    })
    .onConflictDoUpdate({
      target: copilotItemFulltext.itemId,
      set: {
        content: sql`EXCLUDED.content`,
        truncated: sql`EXCLUDED.truncated`,
        fetchedAt: sql`now()`
      }
    });

  await db
    .update(itemsTable)
    .set({ content: extracted.content })
    .where(
      and(
        eq(itemsTable.id, itemId),
        sql`(${itemsTable.content} IS NULL OR ${itemsTable.content} = '' OR ${itemsTable.content} = (SELECT summary_zh FROM item_analysis WHERE item_id = ${itemId}))`
      )
    );
}