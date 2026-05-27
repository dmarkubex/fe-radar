import { createDbClient } from "../src/client";
import { listSources, type SourceRecord, type FetcherType } from "../src/repos/sources";

interface VerifyResult {
  name: string;
  fetcherType: FetcherType;
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
  suggestion: string;
}

const TIMEOUT_MS = 10_000;
const USER_AGENT = "FE-Radar Verify Bot (+https://fe-radar.internal/bot)";

function suggestionFor(result: VerifyResult): string {
  if (result.ok) return "";
  if (result.status === 403) return "Access denied (403). Consider disabling source or switching to playwright with proxy.";
  if (result.status === 404) return "URL not found (404). Verify URL or disable source.";
  if (result.status === 405) return "Method not allowed (405). Check if URL is correct.";
  if (result.status === 429) return "Rate limited (429). Consider increasing interval or using proxy.";
  if (result.error?.includes("fetch failed") || result.error?.includes("ECONNREFUSED")) return "Network unreachable. Check DNS/firewall or disable source.";
  if (result.error?.includes("timeout")) return "Connection timed out. Server may be down or blocking.";
  if (result.error?.includes("SSL") || result.error?.includes("TLS") || result.error?.includes("certificate")) return "TLS/SSL error. Check cert validity or disable source.";
  if (result.fetcherType === "playwright") return "Playwright source unreachable. Verify URL works in browser.";
  return "Investigate error and fix URL/config or disable source.";
}

async function checkHtmlOrRss(url: string): Promise<Pick<VerifyResult, "ok" | "status" | "error">> {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT }
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

async function checkPlaywright(source: SourceRecord): Promise<Pick<VerifyResult, "ok" | "status" | "error">> {
  const config = source.config as Record<string, unknown> | null;
  const waitFor = config?.waitFor as string | undefined;
  const extractor = config?.extractor as string | undefined;

  if (!waitFor || !extractor) {
    return { ok: false, error: `Playwright config missing waitFor or extractor (waitFor=${String(waitFor)}, extractor=${String(extractor)})` };
  }

  const urlCheck = await checkHtmlOrRss(source.url);
  if (!urlCheck.ok) {
    return urlCheck;
  }

  return { ok: true, status: urlCheck.status };
}

async function verifySource(source: SourceRecord): Promise<VerifyResult> {
  if (source.fetcherType === "html" || source.fetcherType === "rss") {
    const config = source.config as Record<string, unknown> | null;
    const targetUrl = (config?.listUrl as string) || (config?.url as string) || source.url;
    const check = await checkHtmlOrRss(targetUrl);
    return { name: source.name, fetcherType: source.fetcherType, url: targetUrl, ...check, suggestion: "" };
  }

  if (source.fetcherType === "playwright") {
    const check = await checkPlaywright(source);
    return { name: source.name, fetcherType: source.fetcherType, url: source.url, ...check, suggestion: "" };
  }

  return {
    name: source.name,
    fetcherType: source.fetcherType,
    url: source.url,
    ok: false,
    error: `Unsupported fetcher_type '${source.fetcherType}' for v1.0 news verification`,
    suggestion: "Skip or handle separately."
  };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("FAIL: DATABASE_URL is not set. Cannot verify sources without a database connection.");
    console.error("Set DATABASE_URL to point to the target database, then re-run.");
    process.exit(1);
  }

  const db = createDbClient({ runtime: "worker" });
  const allEnabled = await listSources(db, { enabled: true });

  const newsSources = allEnabled.filter((s) => s.fetcherType !== "quotes");
  const quotesSources = allEnabled.filter((s) => s.fetcherType === "quotes");

  if (quotesSources.length > 0) {
    console.log(`INFO: Skipping ${quotesSources.length} quotes source(s) — not part of v1.0 news gate.`);
    for (const qs of quotesSources) {
      console.log(`  SKIP\t${qs.name}\t${qs.url}`);
    }
  }

  console.log(`\nVerifying ${newsSources.length} enabled news sources from DB...\n`);

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
      ok: false,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      suggestion: ""
    };
    r.suggestion = suggestionFor(r);
    return r;
  });

  const okCount = checked.filter((item) => item.ok).length;
  const failCount = checked.length - okCount;
  const ratio = checked.length > 0 ? okCount / checked.length : 0;

  for (const item of checked) {
    const tag = item.ok ? "OK" : "FAIL";
    const parts = [tag, item.name, item.fetcherType, item.url];
    if (item.status) parts.push(`HTTP ${item.status}`);
    if (item.error) parts.push(item.error);
    if (item.suggestion) parts.push(`→ ${item.suggestion}`);
    console.log(parts.join("\t"));
  }

  console.log(`\nreachable=${okCount}/${checked.length} ratio=${(ratio * 100).toFixed(1)}%`);

  if (failCount > 0) {
    console.log(`\n--- Failed sources ---`);
    for (const item of checked.filter((i) => !i.ok)) {
      console.log(`  ${item.name}\t${item.fetcherType}\t${item.url}\t${item.error ?? `HTTP ${item.status}`}\t→ ${item.suggestion}`);
    }
  }

  if (ratio < 0.8) {
    throw new Error(`Reachability ${(ratio * 100).toFixed(1)}% is below 80%`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
