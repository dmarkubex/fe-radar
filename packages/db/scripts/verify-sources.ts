/**
 * Lightweight CI reachability gate.
 *
 * This intentionally checks HTTP/selector reachability without importing worker runtime policy.
 * Operations must use @fe-radar/worker verify:sources for proxy/robots/real-parser evidence.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createDbClient } from "../src/client";
import {
  listSources,
  type SourceRecord,
  type FetcherType
} from "../src/repos/sources";

export interface VerifyResult {
  name: string;
  fetcherType: FetcherType;
  url: string;
  sourceEnabled?: boolean;
  ok: boolean;
  status?: number;
  error?: string;
  suggestion: string;
}

export interface ReachabilitySummary {
  enabledCount: number;
  okCount: number;
  failCount: number;
  ratio: number;
}

const TIMEOUT_MS = 10_000;
const PLAYWRIGHT_SELECTOR_TIMEOUT_MS = 5_000;
const USER_AGENT = "FE-Radar Verify Bot (+https://fe-radar.internal/bot)";

// MIRROR: 按 fetcher 类型镜像 rss.ts / html.ts 的读取字段，三处必须同步。
function verificationTargetUrl(
  source: SourceRecord,
  config: Record<string, unknown> | null
): string {
  const configKey =
    source.fetcherType === "rss"
      ? "url"
      : source.fetcherType === "html" || source.fetcherType === "playwright"
        ? "listUrl"
        : undefined;
  const targetUrl = configKey
    ? (config?.[configKey] as string | undefined)
    : undefined;
  if (targetUrl === "")
    throw new Error(`config.${configKey} must not be empty`);
  return targetUrl ?? source.url;
}

export function suggestionFor(result: VerifyResult): string {
  if (result.ok) return "";
  if (result.status === 403)
    return "Access denied (403). Consider disabling source or switching to playwright with proxy.";
  if (result.status === 404)
    return "URL not found (404). Verify URL or disable source.";
  if (result.status === 405)
    return "Method not allowed (405). Check if URL is correct.";
  if (result.status === 429)
    return "Rate limited (429). Consider increasing interval or using proxy.";
  if (
    result.error?.includes("fetch failed") ||
    result.error?.includes("ECONNREFUSED")
  )
    return "Network unreachable. Check DNS/firewall or disable source.";
  if (
    result.error?.includes("SSL") ||
    result.error?.includes("TLS") ||
    result.error?.includes("certificate")
  )
    return "TLS/SSL error. Check cert validity or disable source.";
  if (result.fetcherType === "playwright" && result.error?.includes("selector"))
    return "Selector did not match any elements. Update waitFor/extractor selectors or verify page structure changed.";
  if (result.fetcherType === "playwright")
    return "Playwright source unreachable or selector failed. Verify URL works in browser.";
  if (result.error?.includes("timeout"))
    return "Connection timed out. Server may be down or blocking.";
  return "Investigate error and fix URL/config or disable source.";
}

export async function checkHtmlOrRss(
  url: string
): Promise<Pick<VerifyResult, "ok" | "status" | "error">> {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT }
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}`
      };
    }
    return { ok: true, status: response.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export async function checkPlaywright(
  source: SourceRecord
): Promise<Pick<VerifyResult, "ok" | "status" | "error">> {
  const config = source.config as Record<string, unknown> | null;
  const waitFor = config?.waitFor as string | undefined;
  const extractor = config?.extractor as string | undefined;

  if (!waitFor || !extractor) {
    return {
      ok: false,
      error: `Playwright config missing waitFor or extractor (waitFor=${String(waitFor)}, extractor=${String(extractor)})`
    };
  }

  const targetUrl = verificationTargetUrl(source, config);

  const urlCheck = await checkHtmlOrRss(targetUrl);
  if (!urlCheck.ok) {
    return urlCheck;
  }

  let browser:
    | {
        newPage: () => Promise<{
          goto: (
            u: string,
            o: { timeout: number; waitUntil: string }
          ) => Promise<void>;
          waitForSelector: (s: string, o: { timeout: number }) => Promise<void>;
          $$eval: (
            s: string,
            fn: (els: Element[]) => number
          ) => Promise<number>;
          close: () => Promise<void>;
        }>;
        close: () => Promise<void>;
      }
    | undefined;
  try {
    // @ts-expect-error -- playwright is a workspace-level dep (apps/worker), not declared in @fe-radar/db
    const pw = await import("playwright");
    browser = await pw.chromium.launch({ headless: true });
    const page = await browser!.newPage();
    await page.goto(targetUrl, {
      timeout: TIMEOUT_MS,
      waitUntil: "domcontentloaded"
    });

    try {
      await page.waitForSelector(waitFor, {
        timeout: PLAYWRIGHT_SELECTOR_TIMEOUT_MS
      });
    } catch (selectorErr) {
      const msg =
        selectorErr instanceof Error
          ? selectorErr.message
          : String(selectorErr);
      return { ok: false, error: `selector timeout for '${waitFor}': ${msg}` };
    }

    const itemCount = await page
      .$$eval(waitFor, (els: Element[]) => els.length)
      .catch(() => 0);
    if (itemCount === 0) {
      return {
        ok: false,
        error: `selector '${waitFor}' matched 0 items on page`
      };
    }

    return { ok: true, status: 200 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Cannot find module") || msg.includes("playwright")) {
      return {
        ok: false,
        error:
          "playwright package not available. Install playwright or skip playwright smoke check."
      };
    }
    return { ok: false, error: msg };
  } finally {
    await browser?.close().catch(() => {});
  }
}

export async function verifySource(
  source: SourceRecord
): Promise<VerifyResult> {
  if (source.fetcherType === "html" || source.fetcherType === "rss") {
    const config = source.config as Record<string, unknown> | null;
    const targetUrl = verificationTargetUrl(source, config);
    const check = await checkHtmlOrRss(targetUrl);
    return {
      name: source.name,
      fetcherType: source.fetcherType,
      url: targetUrl,
      sourceEnabled: source.enabled,
      ...check,
      suggestion: ""
    };
  }

  if (source.fetcherType === "playwright") {
    const config = source.config as Record<string, unknown> | null;
    const targetUrl = verificationTargetUrl(source, config);
    const check = await checkPlaywright(source);
    return {
      name: source.name,
      fetcherType: source.fetcherType,
      url: targetUrl,
      sourceEnabled: source.enabled,
      ...check,
      suggestion: ""
    };
  }

  return {
    name: source.name,
    fetcherType: source.fetcherType,
    url: source.url,
    sourceEnabled: source.enabled,
    ok: false,
    error: `Unsupported fetcher_type '${source.fetcherType}' for v1.0 news verification`,
    suggestion: "Skip or handle separately."
  };
}

export function sourcesForVerification(
  allSources: SourceRecord[],
  includeDisabled: boolean
): SourceRecord[] {
  return allSources.filter((source) => {
    const config =
      source.config && typeof source.config === "object"
        ? (source.config as Record<string, unknown>)
        : {};
    if (config.verificationBlocked === true) return false;
    return includeDisabled || source.enabled;
  });
}

export function enabledReachabilitySummary(
  results: VerifyResult[]
): ReachabilitySummary {
  const enabledResults = results.filter(
    (result) => result.sourceEnabled !== false
  );
  const okCount = enabledResults.filter((result) => result.ok).length;
  const failCount = enabledResults.length - okCount;
  return {
    enabledCount: enabledResults.length,
    okCount,
    failCount,
    ratio: enabledResults.length > 0 ? okCount / enabledResults.length : 0
  };
}

export function reachabilityGateFailed(
  summary: ReachabilitySummary,
  includeDisabled: boolean
): boolean {
  if (includeDisabled && summary.enabledCount === 0) return false;
  return summary.ratio < 0.8;
}

export function disabledSourceSuggestion(result: VerifyResult): string {
  if (result.sourceEnabled !== false) return result.suggestion;
  if (result.ok)
    return "Reachable while disabled. Run a content smoke (>=3 real items) before re-enabling.";
  return `Still unreachable while disabled. ${result.suggestion}`.trim();
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "FAIL: DATABASE_URL is not set. Cannot verify sources without a database connection."
    );
    console.error(
      "Set DATABASE_URL to point to the target database, then re-run."
    );
    process.exit(1);
  }

  const includeDisabled = process.argv.slice(2).includes("--include-disabled");
  const db = createDbClient({ runtime: "worker" });
  const allSources = await listSources(
    db,
    includeDisabled ? {} : { enabled: true }
  );
  const selectedSources = sourcesForVerification(allSources, includeDisabled);
  const blockedCount =
    allSources.length - sourcesForVerification(allSources, true).length;
  if (blockedCount > 0) {
    console.log(
      `INFO: Skipping ${blockedCount} source(s) blocked from verification by compliance policy.`
    );
  }

  const newsSources = selectedSources.filter((s) => s.fetcherType !== "quotes");
  const quotesSources = selectedSources.filter(
    (s) => s.fetcherType === "quotes"
  );

  if (quotesSources.length > 0) {
    console.log(
      `INFO: Skipping ${quotesSources.length} quotes source(s) — not part of v1.0 news gate.`
    );
    for (const qs of quotesSources) {
      console.log(`  SKIP\t${qs.name}\t${qs.url}`);
    }
  }

  console.log(
    includeDisabled
      ? `\nVerifying ${newsSources.length} enabled and disabled news sources from DB...\n`
      : `\nVerifying ${newsSources.length} enabled news sources from DB...\n`
  );

  const results = await Promise.allSettled(newsSources.map(verifySource));
  const checked: VerifyResult[] = results.map((result, index) => {
    if (result.status === "fulfilled") {
      const r = result.value;
      r.suggestion = suggestionFor(r);
      return r;
    }
    const source = newsSources[index]!;
    const r: VerifyResult = {
      name: source.name,
      fetcherType: source.fetcherType,
      url: source.url,
      sourceEnabled: source.enabled,
      ok: false,
      error:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      suggestion: ""
    };
    r.suggestion = suggestionFor(r);
    return r;
  });

  const { enabledCount, okCount, failCount, ratio } =
    enabledReachabilitySummary(checked);

  for (const item of checked) {
    const tag = `${item.sourceEnabled === false ? "[DISABLED] " : ""}${item.ok ? "OK" : "FAIL"}`;
    const parts = [tag, item.name, item.fetcherType, item.url];
    if (item.status) parts.push(`HTTP ${item.status}`);
    if (item.error) parts.push(item.error);
    const suggestion = disabledSourceSuggestion(item);
    if (suggestion) parts.push(`→ ${suggestion}`);
    console.log(parts.join("\t"));
  }

  console.log(
    `\nreachable=${okCount}/${enabledCount} ratio=${(ratio * 100).toFixed(1)}%`
  );

  const failedSources = checked.filter((item) => !item.ok);
  if (failedSources.length > 0) {
    console.log(`\n--- Failed sources ---`);
    for (const item of failedSources) {
      const disabledTag = item.sourceEnabled === false ? "[DISABLED] " : "";
      console.log(
        `  ${disabledTag}${item.name}\t${item.fetcherType}\t${item.url}\t${item.error ?? `HTTP ${item.status}`}\t→ ${disabledSourceSuggestion(item)}`
      );
    }
  }

  if (
    reachabilityGateFailed(
      { enabledCount, okCount, failCount, ratio },
      includeDisabled
    )
  ) {
    throw new Error(`Reachability ${(ratio * 100).toFixed(1)}% is below 80%`);
  }

  process.exit(0);
}

// ESM entry detection: compare this module URL to argv[1] (realpath).
// Why not endsWith(".ts"): a .ts-only suffix guard left isMain false and main() never
// ran (silent exit 0). This package's formal entry is tsx via package.json
// `verify:sources` (`tsx scripts/verify-sources.ts`); worker is the package that runs
// compiled .js in production. import.meta.url still matches both tsx (.ts) and node
// (.js) if someone does compile this script.
// Why realpath: macOS /tmp → /private/tmp (and any ln -s). resolve() alone keeps the
// symlink path while Node's import.meta.url is already realpath'd → isMain false →
// silent exit 0. realpathSync throws if the path is missing; fall back to resolve().
// MIRROR: apps/worker/src/scripts/verify-sources.ts + apps/worker/src/scripts/backfill-circles.ts
// — same guard; change all three or none.
function resolveArgvPath(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}
const isMain = Boolean(
  process.argv[1] &&
    import.meta.url === pathToFileURL(resolveArgvPath(process.argv[1])).href
);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
