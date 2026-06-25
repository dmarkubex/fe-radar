import { readFileSync } from "node:fs";
import { SourceFetchError } from "@fe-radar/shared";
import type { WebsearchResult } from "./types";

const DEFAULT_BASE_URL = "https://open.feedcoopapi.com/search_api/web_search";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface WebsearchClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  timeRange?: "OneDay" | "OneWeek" | "OneMonth" | "OneYear";
  count?: number;
  authInfoLevel?: number;
}

interface WebsearchResponse {
  Result?: {
    WebResults?: WebsearchResult[];
  };
}

function readEnvOrSecretFile(envName: string, fileEnvName: string): string | undefined {
  const direct = process.env[envName]?.trim();
  if (direct) {
    return direct;
  }

  const filePath = process.env[fileEnvName]?.trim();
  if (!filePath) {
    return undefined;
  }

  try {
    return readFileSync(filePath, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

export function resolveWebsearchApiKey(explicit?: string): string | undefined {
  const key = explicit?.trim() || readEnvOrSecretFile("WEBSEARCH_API_KEY", "WEBSEARCH_API_KEY_FILE");
  return key || undefined;
}

export function resolveWebsearchBaseUrl(explicit?: string): string {
  const base = explicit?.trim() || process.env.WEBSEARCH_API_URL?.trim() || DEFAULT_BASE_URL;
  return base.replace(/\/$/, "");
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "TimeoutError" || error.name === "AbortError";
}

export async function websearchSearch(
  query: string,
  options: WebsearchClientOptions = {}
): Promise<WebsearchResult[]> {
  const apiKey = resolveWebsearchApiKey(options.apiKey);
  if (!apiKey) {
    throw new SourceFetchError("FETCH_CONFIG", "WEBSEARCH_API_KEY is not configured");
  }

  const baseUrl = resolveWebsearchBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const body: Record<string, unknown> = {
    Query: query,
    SearchType: "web",
    Count: options.count ?? 10,
    TimeRange: options.timeRange ?? "OneWeek",
    Filter: {
      AuthInfoLevel: options.authInfoLevel ?? 0,
    },
  };

  let response: Response;
  try {
    response = await fetchImpl(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new SourceFetchError("FETCH_TIMEOUT", `websearch timed out after ${timeoutMs}ms`, { query });
    }
    throw new SourceFetchError("FETCH_HTTP_ERROR", "websearch request failed", { query, cause: error });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new SourceFetchError(
      "FETCH_HTTP_ERROR",
      `websearch failed with ${response.status}`,
      { status: response.status, body: text.slice(0, 500) }
    );
  }

  const payload = (await response.json()) as WebsearchResponse;

  const results = payload.Result?.WebResults;
  if (!Array.isArray(results)) {
    return [];
  }

  return results;
}
