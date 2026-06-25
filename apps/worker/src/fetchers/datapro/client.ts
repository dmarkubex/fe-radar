import { readFileSync } from "node:fs";
import { SourceFetchError } from "@fe-radar/shared";

const DEFAULT_BASE_URL = "https://datapro.hqd.cn-beijing.volces.com/mcp";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface DataproClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface DataproItem {
  table: Record<string, string>;
}

export interface DataproSearchResult {
  items: DataproItem[];
}

interface McpContent {
  type: string;
  text: string;
}

interface McpResponse {
  jsonrpc: "2.0";
  id: number;
  result?: {
    content: McpContent[];
  };
  error?: {
    code: number;
    message: string;
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

export function resolveDataproApiKey(explicit?: string): string | undefined {
  const key = explicit?.trim() || readEnvOrSecretFile("DATAPRO_AGENT_PLAN_KEY", "DATAPRO_AGENT_PLAN_KEY_FILE");
  return key || undefined;
}

export function resolveDataproBaseUrl(explicit?: string): string {
  const base = explicit?.trim() || process.env.DATAPRO_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return base.replace(/\/$/, "");
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "TimeoutError" || error.name === "AbortError";
}

export async function dataproSearch(
  query: string,
  options: DataproClientOptions = {}
): Promise<DataproItem[]> {
  const apiKey = resolveDataproApiKey(options.apiKey);
  if (!apiKey) {
    throw new SourceFetchError("FETCH_CONFIG", "DATAPRO_AGENT_PLAN_KEY is not configured");
  }

  const baseUrl = resolveDataproBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const body = {
    jsonrpc: "2.0" as const,
    method: "tools/call",
    params: {
      name: "dataPro_search",
      arguments: { query },
    },
    id: 1,
  };

  let response: Response;
  try {
    response = await fetchImpl(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-plan-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new SourceFetchError("FETCH_TIMEOUT", `dataPro search timed out after ${timeoutMs}ms`, { query });
    }
    throw new SourceFetchError("FETCH_HTTP_ERROR", "dataPro search request failed", { query, cause: error });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new SourceFetchError(
      "FETCH_HTTP_ERROR",
      `dataPro search failed with ${response.status}`,
      { status: response.status, body: text.slice(0, 500) }
    );
  }

  const payload = (await response.json()) as McpResponse;

  if (payload.error) {
    throw new SourceFetchError(
      "FETCH_PARSE_ERROR",
      `dataPro MCP error: ${payload.error.message}`,
      { code: payload.error.code, query }
    );
  }

  const firstContent = payload.result?.content?.[0];
  // P1-4: content 为空数组视为合法空结果（0 条），不抛 FETCH_PARSE_ERROR
  if (!firstContent?.text) {
    if (payload.result?.content && payload.result.content.length === 0) {
      return [];
    }
    throw new SourceFetchError(
      "FETCH_PARSE_ERROR",
      "dataPro MCP response missing result.content[0].text",
      { query }
    );
  }

  let parsed: DataproSearchResult;
  try {
    parsed = JSON.parse(firstContent.text) as DataproSearchResult;
  } catch (error) {
    throw new SourceFetchError(
      "FETCH_PARSE_ERROR",
      "dataPro MCP content[0].text is not valid JSON",
      { query, cause: error }
    );
  }

  if (!Array.isArray(parsed.items)) {
    throw new SourceFetchError(
      "FETCH_PARSE_ERROR",
      "dataPro MCP parsed content missing items array",
      { query }
    );
  }

  return parsed.items;
}
