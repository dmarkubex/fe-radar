/**
 * Production-path content verification for operations.
 *
 * Unlike @fe-radar/db's lightweight CI reachability gate, this runs the worker's real fetcher
 * dispatch, including proxy selection, real-UA policy, and robots checks, then requires >=3
 * parsed items. It is read-only: re-enabling a source remains a migration/admin action.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createDbClient,
  listSources,
  type FetcherType,
  type SourceRecord
} from "@fe-radar/db";

import { fetchSourceItems, type SourceConfig } from "../fetchers";
import { assertRobotsAllowed } from "../lib/robots";
import { acquireUserAgent } from "../lib/ua-pool";

const MIN_ITEMS = 3;
const SOURCE_INTERVAL_MS = 1_000;
const NON_CONTENT_FETCHERS = new Set<FetcherType>([
  "quotes",
  "datapro",
  "websearch"
]);

export function parseSourceIdArg(argv: readonly string[]): number | null {
  const idx = argv.indexOf("--source-id");
  if (idx === -1) return null;
  const raw = argv[idx + 1];
  if (raw === undefined || raw === "") {
    throw new Error("--source-id requires a positive integer value");
  }
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(
      `--source-id value "${raw}" is not a positive integer (must be >0, digits only)`
    );
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(
      `--source-id value "${raw}" is not a positive integer (must be >0, digits only)`
    );
  }
  return parsed;
}

export function filterSourcesById(
  sources: readonly SourceRecord[],
  id: number
): SourceRecord[] {
  return sources.filter((source) => source.id === id);
}

export function toJsonlResult(result: DeepVerifyResult): string {
  const payload: Record<string, unknown> = {
    kind: "result",
    id: result.id,
    name: result.name,
    url: result.url,
    fetcherType: result.fetcherType,
    sourceEnabled: result.sourceEnabled,
    status: result.status
  };
  if (result.itemCount !== undefined) {
    payload.itemCount = result.itemCount;
  }
  if (result.error !== undefined) {
    payload.error = result.error;
  }
  return `${JSON.stringify(payload)}\n`;
}

export function toJsonlSummary(results: DeepVerifyResult[]): string {
  const passed = results.filter((result) => result.status === "pass").length;
  const failed = results.filter((result) => result.status === "fail").length;
  const skipped = results.filter(
    (result) => result.status === "skipped"
  ).length;
  const payload = {
    kind: "summary",
    passed,
    failed,
    skipped,
    total: results.length
  };
  return `${JSON.stringify(payload)}\n`;
}

export interface DeepVerifyResult {
  id: number;
  name: string;
  url: string;
  fetcherType: FetcherType;
  sourceEnabled: boolean;
  status: "pass" | "fail" | "skipped";
  itemCount?: number;
  error?: string;
}

interface VerifyOptions {
  includeDisabled?: boolean;
  minItems?: number;
  intervalMs?: number;
  fetchItems?: typeof fetchSourceItems;
  robotsCheck?: typeof assertRobotsAllowed;
  pause?: (ms: number) => Promise<void>;
}

function sourceConfig(source: SourceRecord): Record<string, unknown> {
  return source.config && typeof source.config === "object"
    ? (source.config as Record<string, unknown>)
    : {};
}

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

export async function verifySourcesWithWorker(
  sources: readonly SourceRecord[],
  options: VerifyOptions = {}
): Promise<DeepVerifyResult[]> {
  const includeDisabled = options.includeDisabled ?? false;
  const minItems = options.minItems ?? MIN_ITEMS;
  const intervalMs = options.intervalMs ?? SOURCE_INTERVAL_MS;
  const fetchItems = options.fetchItems ?? fetchSourceItems;
  const robotsCheck = options.robotsCheck ?? assertRobotsAllowed;
  const pause =
    options.pause ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const results: DeepVerifyResult[] = [];
  let probed = 0;

  for (const source of sources) {
    if (!includeDisabled && !source.enabled) continue;

    const base = {
      id: source.id,
      name: source.name,
      url: source.url,
      fetcherType: source.fetcherType,
      sourceEnabled: source.enabled
    };
    const config = sourceConfig(source);

    if (config.verificationBlocked === true) {
      results.push({
        ...base,
        status: "skipped",
        error:
          typeof config.verificationBlockedReason === "string"
            ? config.verificationBlockedReason
            : "blocked by compliance policy"
      });
      continue;
    }

    if (NON_CONTENT_FETCHERS.has(source.fetcherType)) {
      results.push({
        ...base,
        status: "skipped",
        error: "not a scheduled content fetcher for this verification gate"
      });
      continue;
    }

    if (probed > 0 && intervalMs > 0) await pause(intervalMs);
    probed += 1;

    try {
      const useRealUa = config.useRealUa === true;
      const targetUrl = verificationTargetUrl(source, config);
      const protocol = new URL(targetUrl).protocol;
      if (protocol === "http:" || protocol === "https:") {
        await robotsCheck(targetUrl, acquireUserAgent(useRealUa));
      }
      const items = await fetchItems(config as unknown as SourceConfig, {
        sourceName: source.name,
        useRealUa
      });
      results.push({
        ...base,
        status: items.length >= minItems ? "pass" : "fail",
        itemCount: items.length,
        ...(items.length >= minItems
          ? {}
          : { error: `parsed ${items.length} item(s), requires >=${minItems}` })
      });
    } catch (error) {
      results.push({
        ...base,
        status: "fail",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return results;
}

export function printResults(results: DeepVerifyResult[]): void {
  for (const result of results) {
    const disabled = result.sourceEnabled ? "" : " [DISABLED]";
    const count =
      result.itemCount === undefined ? "" : ` items=${result.itemCount}`;
    const error = result.error ? ` ${result.error}` : "";
    console.log(
      `${result.status.toUpperCase()}${disabled}\t${result.name}\t${result.fetcherType}\t${result.url}${count}${error}`
    );
  }

  const passed = results.filter((result) => result.status === "pass").length;
  const failed = results.filter((result) => result.status === "fail").length;
  const skipped = results.filter(
    (result) => result.status === "skipped"
  ).length;
  console.log(
    `worker-content-verification passed=${passed} failed=${failed} skipped=${skipped}`
  );
}

export function printJsonlResults(results: DeepVerifyResult[]): void {
  for (const result of results) {
    process.stdout.write(toJsonlResult(result));
  }
  process.stdout.write(toJsonlSummary(results));
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const includeDisabled = process.argv.includes("--include-disabled");
  const jsonOutput = process.argv.includes("--json");
  const sourceId = parseSourceIdArg(process.argv);

  const db = createDbClient({ runtime: "worker" });
  const allSources = await listSources(
    db,
    includeDisabled ? {} : { enabled: true }
  );

  const sources =
    sourceId === null ? allSources : filterSourcesById(allSources, sourceId);
  if (sourceId !== null && sources.length === 0) {
    throw new Error(
      `--source-id ${sourceId} not found in sources table (include-disabled=${
        includeDisabled ? "true" : "false"
      })`
    );
  }

  const results = await verifySourcesWithWorker(sources, { includeDisabled });
  if (jsonOutput) {
    printJsonlResults(results);
  } else {
    printResults(results);
  }

  if (results.some((result) => result.status === "fail")) {
    throw new Error("one or more sources failed the >=3 parsed-item gate");
  }
  process.exit(0);
}

// ESM entry detection: compare this module URL to argv[1] (realpath).
// Why not endsWith(".ts"): production image runs compiled .js only (Dockerfile.worker
// COPYs dist/, no TS source / no tsx), so a .ts-only suffix guard left isMain false and
// main() never ran (silent exit 0). import.meta.url matches both tsx (.ts) and node (.js).
// Why realpath: macOS /tmp → /private/tmp (and any ln -s). resolve() alone keeps the
// symlink path while Node's import.meta.url is already realpath'd → isMain false →
// silent exit 0. realpathSync throws if the path is missing; fall back to resolve().
// MIRROR: packages/db/scripts/verify-sources.ts + apps/worker/src/scripts/backfill-circles.ts
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
