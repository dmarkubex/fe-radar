import { createLogger, SourceFetchError } from "@fe-radar/shared";
import { Agent, fetch as undiciFetch, ProxyAgent } from "undici";
import type { Dispatcher } from "undici";
import { proxyPool } from "../lib/proxy-pool";
import { assertRobotsAllowed } from "../lib/robots";
import { acquireUserAgent } from "../lib/ua-pool";

const logger = createLogger({ service: "fetch-http" });

type FetchInitWithDispatcher = RequestInit & { dispatcher?: Dispatcher };
interface ReadableTextResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  body: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<void>;
    };
  } | null;
  text(): Promise<string>;
}

export interface FetchTextOptions {
  timeoutMs: number;
  useRealUa?: boolean;
  insecureTLS?: boolean;
  maxResponseBytes?: number;
  source?: string;
  fetchImpl?: (
    input: string,
    init: FetchInitWithDispatcher
  ) => Promise<Response>;
  /**
   * Optional extra RequestInit to merge into the policy fetch (e.g. POST method
   * and JSON body for adapters hitting public search APIs). The policy layer
   * still owns the user-agent, dispatcher, timeout abort, robots check, retry
   * loop, response-size limit, and proxy release semantics. Caller-supplied
   * headers are merged in but cannot remove or replace the policy-managed
   * `user-agent` header. Caller-supplied `signal` is ignored — the policy
   * layer always attaches its own timeout abort to preserve retry behavior.
   */
  init?: Omit<RequestInit, "headers" | "signal" | "dispatcher"> & {
    headers?: HeadersInit;
  };
}

function buildDispatcher(
  proxyServer: string | undefined,
  insecureTLS: boolean
): Dispatcher | undefined {
  if (proxyServer) {
    if (insecureTLS) {
      return new ProxyAgent({
        uri: proxyServer,
        requestTls: { rejectUnauthorized: false }
      });
    }
    return new ProxyAgent(proxyServer);
  }

  if (insecureTLS) {
    return new Agent({ connect: { rejectUnauthorized: false } });
  }

  return undefined;
}

async function readTextWithLimit(
  response: ReadableTextResponse,
  maxResponseBytes: number | undefined,
  url: string
): Promise<string> {
  if (maxResponseBytes === undefined) return response.text();

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    throw new SourceFetchError(
      "FETCH_RESPONSE_TOO_LARGE",
      "Fetch response exceeds configured size limit",
      {
        url,
        contentLength,
        maxResponseBytes
      }
    );
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxResponseBytes) {
      throw new SourceFetchError(
        "FETCH_RESPONSE_TOO_LARGE",
        "Fetch response exceeds configured size limit",
        {
          url,
          maxResponseBytes
        }
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maxResponseBytes) {
      await reader.cancel();
      throw new SourceFetchError(
        "FETCH_RESPONSE_TOO_LARGE",
        "Fetch response exceeds configured size limit",
        {
          url,
          maxResponseBytes
        }
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function fetchTextWithPolicy(
  url: string,
  options: FetchTextOptions
): Promise<string> {
  const userAgent = acquireUserAgent(options.useRealUa);
  const insecureTLS = options.insecureTLS === true;

  if (insecureTLS) {
    logger.warn(
      { source: options.source ?? "unknown", url },
      "fetch using insecure TLS"
    );
  }

  let proxy = proxyPool.acquire();
  let lastError: unknown;
  const fetchImpl = async (
    input: string,
    init: FetchInitWithDispatcher
  ): Promise<ReadableTextResponse> => {
    if (options.fetchImpl) {
      return options.fetchImpl(input, init);
    }
    return undiciFetch(
      input,
      init as Parameters<typeof undiciFetch>[1]
    ) as unknown as Promise<ReadableTextResponse>;
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const dispatcher = buildDispatcher(proxy?.server, insecureTLS);
    const policyFetch = ((input: string | URL | Request, init?: RequestInit) =>
      fetchImpl(input.toString(), {
        ...init,
        dispatcher
      } as FetchInitWithDispatcher)) as unknown as typeof fetch;
    try {
      // robots.txt and content must use the same network path. Cache by proxy identity so a
      // retry through another proxy cannot reuse a policy fetched through a different route.
      await assertRobotsAllowed(
        url,
        userAgent,
        policyFetch,
        proxy?.id ?? "direct"
      );
    } catch (error) {
      proxyPool.release(proxy, true);
      throw error;
    }

    try {
      const callerHeaders = options.init?.headers;
      // Merge caller headers, but always pin the policy-managed user-agent so
      // adapters cannot downgrade the rotated UA. We keep the result as a
      // plain object so the merged headers survive fetch impls that read
      // `init.headers` as a string-keyed record (undici does this).
      const mergedHeaders: Record<string, string> = {};
      if (callerHeaders) {
        const tmp = new Headers(callerHeaders);
        tmp.forEach((value, key) => {
          mergedHeaders[key.toLowerCase()] = value;
        });
      }
      mergedHeaders["user-agent"] = userAgent;
      // Caller-supplied `signal` is intentionally ignored — the policy layer
      // always attaches its own timeout abort to keep retry semantics intact.
      const response = await fetchImpl(url, {
        ...(options.init ?? {}),
        headers: mergedHeaders,
        signal: AbortSignal.timeout(options.timeoutMs),
        dispatcher
      });
      if (response.status === 403 || response.status === 429) {
        proxyPool.release(proxy, false);
        proxy = proxyPool.acquire({ retry: true });
        lastError = new SourceFetchError(
          `FETCH_${response.status}`,
          `Fetch rejected with ${response.status}`,
          { url }
        );
        continue;
      }

      if (!response.ok) {
        throw new SourceFetchError(
          "FETCH_HTTP_ERROR",
          `Fetch failed with ${response.status}`,
          { url }
        );
      }

      const body = await readTextWithLimit(
        response,
        options.maxResponseBytes,
        url
      );
      proxyPool.release(proxy, true);
      return body;
    } catch (error) {
      if (
        error instanceof SourceFetchError &&
        error.code === "FETCH_RESPONSE_TOO_LARGE"
      ) {
        proxyPool.release(proxy, true);
        throw error;
      }
      proxyPool.release(proxy, false);
      proxy = proxyPool.acquire({ retry: true });
      lastError = error;
    }
  }

  if (lastError instanceof SourceFetchError) {
    throw lastError;
  }
  throw new SourceFetchError("FETCH_TIMEOUT", "Fetch failed after retries", {
    url,
    cause: lastError
  });
}
