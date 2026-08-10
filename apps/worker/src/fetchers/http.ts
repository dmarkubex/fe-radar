import { createLogger, SourceFetchError } from "@fe-radar/shared";
import { assertPublicFetchUrl, isInternalAllowlisted, isPrivateIp } from "@fe-radar/core";
import dns from "node:dns";
import type { LookupFunction } from "node:net";
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

/**
 * T-SEC-12: 连接时 DNS 复验，堵 DNS rebinding TOCTOU。
 * assertPublicFetchUrl 在 fetch 前解析过一次，但 undici 建连时会再解析一次，TTL=0 域名
 * 可在两次解析之间换成内网 IP。把守卫钉到 net/tls.connect 的 lookup 上：连接实际解析时
 * 对每个返回地址跑 isPrivateIp，任一私网 / 保留地址即报错拒绝建连。
 * allowlist（FETCH_INTERNAL_ALLOWLIST）内 hostname 豁免 —— 内部服务（如 rsshub:1200）
 * 解析到私网 IP 属正常，与 assertPublicFetchUrl 的 allowlist 分支同一判定。
 */
export function createSsrfGuardedLookup(): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, records) => {
      if (err) {
        callback(err, [], undefined);
        return;
      }
      if (!isInternalAllowlisted(hostname)) {
        for (const record of records) {
          if (isPrivateIp(record.address)) {
            const blocked = new Error(
              `SSRF guard: connection-time DNS resolution of ${hostname} hit blocked address ${record.address}`
            ) as NodeJS.ErrnoException;
            blocked.code = "FETCH_SSRF_BLOCKED";
            callback(blocked, [], undefined);
            return;
          }
        }
      }
      if (options.all) {
        callback(null, records);
      } else {
        callback(null, records[0]?.address ?? "", records[0]?.family ?? 4);
      }
    });
  };
}

function buildDispatcher(
  proxyServer: string | undefined,
  insecureTLS: boolean
): Dispatcher | undefined {
  if (proxyServer) {
    // 代理路径残余风险：目标 hostname 的 DNS 解析发生在代理端，本地 lookup 守卫管不到
    // 实际连接目标。内网代理部署下由代理出口策略兜底；fetch 前的 assertPublicFetchUrl
    // 与逐跳重定向复验仍然生效。
    if (insecureTLS) {
      return new ProxyAgent({
        uri: proxyServer,
        requestTls: { rejectUnauthorized: false }
      });
    }
    return new ProxyAgent(proxyServer);
  }

  // 非代理路径一律显式建 Agent，挂上连接时 lookup 复验（TOCTOU 防线）。
  if (insecureTLS) {
    return new Agent({ connect: { rejectUnauthorized: false, lookup: createSsrfGuardedLookup() } });
  }

  return new Agent({ connect: { lookup: createSsrfGuardedLookup() } });
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

const MAX_REDIRECTS = 5;

/**
 * 复核 F5: 手动逐跳跟随重定向，对每个 Location header 复跑 SSRF 守卫，防止初始 URL 合法
 * 但 302 跳到内网/metadata。fetchImpl 必须以 redirect: "manual" 调用（不会自动跟随）。
 */
async function followRedirectsWithGuard(
  fetchOnce: (url: string) => Promise<ReadableTextResponse>,
  startUrl: string
): Promise<ReadableTextResponse> {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetchOnce(currentUrl);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        throw new SourceFetchError("FETCH_HTTP_ERROR", `Redirect ${res.status} without Location header`, { url: currentUrl });
      }
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        throw new SourceFetchError("FETCH_HTTP_ERROR", `Invalid redirect Location: ${location}`, { url: currentUrl });
      }
      // 复跑 SSRF 守卫（含 DNS 解析），拒绝跳到内网/metadata。
      if (process.env.SSRF_GUARD_ENABLED !== "false") {
        const guard = await assertPublicFetchUrl(nextUrl);
        if (!guard.allowed) {
          throw new SourceFetchError("FETCH_SSRF_BLOCKED", `Redirect target blocked by SSRF guard: ${guard.reason}`, { url: nextUrl, reason: guard.reason, from: currentUrl });
        }
      }
      currentUrl = nextUrl;
      continue;
    }
    return res;
  }
  throw new SourceFetchError("FETCH_HTTP_ERROR", `Too many redirects (>${MAX_REDIRECTS})`, { url: startUrl });
}

export async function fetchTextWithPolicy(
  url: string,
  options: FetchTextOptions
): Promise<string> {
  // T-SEC-12: SSRF 守卫在实际网络边界拦截 —— 拒绝非 http(s) / URL 凭据 / 非标端口 / 解析到内网
  // (loopback/private/link-local/metadata) 的目的地。每次实际 fetch 前复验，防 DNS rebinding。
  // 默认开启；测试可经 SSRF_GUARD_ENABLED=false 关闭（避免离线 DNS 失败误拒公共域名）。
  if (process.env.SSRF_GUARD_ENABLED !== "false") {
    const guard = await assertPublicFetchUrl(url);
    if (!guard.allowed) {
      throw new SourceFetchError(
        "FETCH_SSRF_BLOCKED",
        `Outbound URL blocked by SSRF guard: ${guard.reason}`,
        { url, reason: guard.reason }
      );
    }
  }

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
      // 复核 F5: 关闭自动重定向，手动逐跳跟随并对每个 Location 复跑 SSRF 守卫，
      // 防止初始 URL 合法但 302 跳到内网/metadata。
      const response = await followRedirectsWithGuard(
        (u: string) => fetchImpl(u, {
          ...(options.init ?? {}),
          headers: mergedHeaders,
          signal: AbortSignal.timeout(options.timeoutMs),
          dispatcher,
          redirect: "manual"
        } as RequestInit),
        url
      );
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
