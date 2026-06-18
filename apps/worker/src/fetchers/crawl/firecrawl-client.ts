import { readFileSync } from "node:fs";
import { SourceFetchError } from "@fe-radar/shared";
import type { FirecrawlSearchRequest, FirecrawlSearchResponse } from "./types";

const DEFAULT_BASE_URL = "https://api.firecrawl.dev/v2";

export interface FirecrawlClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
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

export function resolveFirecrawlApiKey(explicit?: string): string | undefined {
  const key = explicit?.trim() || readEnvOrSecretFile("FIRECRAWL_API_KEY", "FIRECRAWL_API_KEY_FILE");
  return key || undefined;
}

export function resolveFirecrawlBaseUrl(explicit?: string): string {
  const base = explicit?.trim() || process.env.FIRECRAWL_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return base.replace(/\/$/, "");
}

export async function firecrawlSearch(
  request: FirecrawlSearchRequest,
  options: FirecrawlClientOptions = {}
): Promise<FirecrawlSearchResponse> {
  const apiKey = resolveFirecrawlApiKey(options.apiKey);
  if (!apiKey) {
    throw new SourceFetchError("FETCH_CONFIG", "FIRECRAWL_API_KEY is not configured");
  }

  const baseUrl = resolveFirecrawlBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;

  const body: Record<string, unknown> = {
    query: request.query,
    limit: request.limit ?? 5,
    country: request.country ?? "CN",
    sources: request.sources ?? [{ type: "web" }],
    ignoreInvalidURLs: true,
  };

  if (request.includeDomains?.length) {
    body.includeDomains = request.includeDomains;
  }
  if (request.excludeDomains?.length) {
    body.excludeDomains = request.excludeDomains;
  }
  if (request.location?.trim()) {
    body.location = request.location.trim();
  }
  if (request.tbs?.trim()) {
    body.tbs = request.tbs.trim();
  }

  const response = await fetchImpl(`${baseUrl}/search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new SourceFetchError(
      "FETCH_HTTP_ERROR",
      `Firecrawl search failed with ${response.status}`,
      { status: response.status, body: text.slice(0, 500) }
    );
  }

  const payload = (await response.json()) as FirecrawlSearchResponse;
  if (payload.success === false) {
    throw new SourceFetchError(
      "FETCH_PARSE_ERROR",
      payload.error ?? "Firecrawl search returned success=false",
      { query: request.query }
    );
  }

  return payload;
}
