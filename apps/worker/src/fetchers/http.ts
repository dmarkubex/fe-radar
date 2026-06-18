import { createLogger, SourceFetchError } from "@fe-radar/shared";
import { Agent, fetch as undiciFetch, ProxyAgent } from "undici";
import type { Dispatcher } from "undici";
import { proxyPool } from "../lib/proxy-pool";
import { assertRobotsAllowed } from "../lib/robots";
import { acquireUserAgent } from "../lib/ua-pool";

const logger = createLogger({ service: "fetch-http" });

type FetchInitWithDispatcher = RequestInit & { dispatcher?: Dispatcher };

export interface FetchTextOptions {
  timeoutMs: number;
  useRealUa?: boolean;
  insecureTLS?: boolean;
  source?: string;
  fetchImpl?: (input: string, init: FetchInitWithDispatcher) => Promise<Response>;
}

function buildDispatcher(proxyServer: string | undefined, insecureTLS: boolean): Dispatcher | undefined {
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

export async function fetchTextWithPolicy(url: string, options: FetchTextOptions): Promise<string> {
  const userAgent = acquireUserAgent(options.useRealUa);
  await assertRobotsAllowed(url, userAgent, (options.fetchImpl ?? fetch) as typeof fetch);
  const insecureTLS = options.insecureTLS === true;

  if (insecureTLS) {
    logger.warn({ source: options.source ?? "unknown", url }, "fetch using insecure TLS");
  }

  let proxy = proxyPool.acquire();
  let lastError: unknown;
  const fetchImpl = options.fetchImpl ?? undiciFetch;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { "user-agent": userAgent },
        signal: AbortSignal.timeout(options.timeoutMs),
        dispatcher: buildDispatcher(proxy?.server, insecureTLS)
      });

      if (response.status === 403 || response.status === 429) {
        proxyPool.release(proxy, false);
        proxy = proxyPool.acquire({ retry: true });
        lastError = new SourceFetchError(`FETCH_${response.status}`, `Fetch rejected with ${response.status}`, { url });
        continue;
      }

      if (!response.ok) {
        throw new SourceFetchError("FETCH_HTTP_ERROR", `Fetch failed with ${response.status}`, { url });
      }

      proxyPool.release(proxy, true);
      return response.text();
    } catch (error) {
      proxyPool.release(proxy, false);
      proxy = proxyPool.acquire({ retry: true });
      lastError = error;
    }
  }

  if (lastError instanceof SourceFetchError) {
    throw lastError;
  }
  throw new SourceFetchError("FETCH_TIMEOUT", "Fetch failed after retries", { url, cause: lastError });
}
