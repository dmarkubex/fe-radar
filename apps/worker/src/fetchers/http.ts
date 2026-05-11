import { SourceFetchError } from "@fe-radar/shared";
import { proxyPool } from "../lib/proxy-pool";
import { assertRobotsAllowed } from "../lib/robots";
import { acquireUserAgent } from "../lib/ua-pool";

export interface FetchTextOptions {
  timeoutMs: number;
  useRealUa?: boolean;
  fetchImpl?: typeof fetch;
}

export async function fetchTextWithPolicy(url: string, options: FetchTextOptions): Promise<string> {
  const userAgent = acquireUserAgent(options.useRealUa);
  await assertRobotsAllowed(url, userAgent, options.fetchImpl ?? fetch);

  let proxy = proxyPool.acquire();
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await (options.fetchImpl ?? fetch)(url, {
        headers: { "user-agent": userAgent },
        signal: AbortSignal.timeout(options.timeoutMs)
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
