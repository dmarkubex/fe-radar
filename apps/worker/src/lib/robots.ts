import robotsParser from "robots-parser";
import { assertPublicFetchUrl } from "@fe-radar/core";
import { createLogger, SourceFetchError } from "@fe-radar/shared";
import { DEFAULT_USER_AGENT } from "./ua-pool";

const logger = createLogger({ service: "robots" });

interface RobotsCacheEntry {
  expiresAt: number;
  parser: ReturnType<typeof robotsParser>;
}

const robotsCache = new Map<string, RobotsCacheEntry>();
const ROBOTS_CACHE_MS = 24 * 60 * 60 * 1000;
/** robots.txt 体积上限（防恶意超大响应 OOM）；正常 robots 远小于此。 */
const MAX_ROBOTS_BYTES = 512 * 1024;
const MAX_REDIRECTS = 5;

export async function assertRobotsAllowed(
  url: string,
  userAgent = DEFAULT_USER_AGENT,
  fetchImpl: typeof fetch = fetch,
  cacheScope = "direct"
): Promise<void> {
  const target = new URL(url);
  const parser = await getRobotsParser(target, fetchImpl, cacheScope);
  if (!parser.isAllowed(url, userAgent)) {
    throw new SourceFetchError(
      "ROBOTS_DISALLOWED",
      `robots.txt disallows ${target.pathname}`,
      {
        origin: target.origin,
        path: target.pathname
      }
    );
  }
}

async function getRobotsParser(
  target: URL,
  fetchImpl: typeof fetch,
  cacheScope: string
): Promise<ReturnType<typeof robotsParser>> {
  const origin = target.origin;
  const cacheKey = `${origin}|${cacheScope}`;
  const cached = robotsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.parser;
  }

  const robotsUrl = new URL("/robots.txt", origin).toString();
  // robots.txt 不可达时 fail-open（允许抓取），避免网络抖动导致整源失败；明确 Disallow 仍拦截。
  // SSRF 拒绝 / 响应超限 **不** fail-open：否则攻击者可 302→内网 逼出 fail-open 跳过 Disallow，
  // 违反「代理池不得绕 robots.txt」合规底线。守卫使 robots 检查更严，不削弱。
  let body = "User-agent: *\nAllow: /";
  try {
    const fetched = await fetchRobotsText(robotsUrl, fetchImpl);
    if (fetched !== null) {
      body = fetched;
    } else {
      logger.warn({ origin, robotsUrl }, "robots.txt unavailable, fail-open");
    }
  } catch (error) {
    if (error instanceof SourceFetchError) {
      // FETCH_SSRF_BLOCKED / FETCH_RESPONSE_TOO_LARGE / 过多跳转 — 向上抛，禁止 fail-open 绕过
      throw error;
    }
    logger.warn({ error, origin }, "robots.txt fetch failed, fail-open");
  }

  const parser = robotsParser(robotsUrl, body);
  robotsCache.set(cacheKey, {
    parser,
    expiresAt: Date.now() + ROBOTS_CACHE_MS
  });
  return parser;
}

/**
 * 带 SSRF 守卫的 robots.txt 抓取：
 * - 每一跳（含首跳）请求前 assertPublicFetchUrl
 * - redirect: "manual"，逐跳复验 Location，拒绝对内网/metadata 的第二跳
 * - 响应字节上限
 *
 * @returns 正文；HTTP 非 2xx / 无 Location 的 3xx → null（调用方 fail-open）
 * @throws SourceFetchError SSRF 拒绝 / 过大 / 过多跳转
 */
async function fetchRobotsText(
  startUrl: string,
  fetchImpl: typeof fetch
): Promise<string | null> {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (process.env.SSRF_GUARD_ENABLED !== "false") {
      const guard = await assertPublicFetchUrl(currentUrl);
      if (!guard.allowed) {
        throw new SourceFetchError(
          "FETCH_SSRF_BLOCKED",
          `robots.txt URL blocked by SSRF guard: ${guard.reason}`,
          { url: currentUrl, reason: guard.reason }
        );
      }
    }

    const response = await fetchImpl(currentUrl, {
      signal: AbortSignal.timeout(3000),
      redirect: "manual"
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return null;
      }
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        return null;
      }
      // 下一轮循环入口会先 guard 再 fetch；内网 Location 在发出第二跳前被拒。
      currentUrl = nextUrl;
      continue;
    }

    if (!response.ok) {
      return null;
    }

    return readTextWithByteLimit(response, MAX_ROBOTS_BYTES, currentUrl);
  }

  throw new SourceFetchError(
    "FETCH_HTTP_ERROR",
    `robots.txt too many redirects (>${MAX_REDIRECTS})`,
    { url: startUrl }
  );
}

async function readTextWithByteLimit(
  response: Response,
  maxBytes: number,
  url: string
): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new SourceFetchError(
        "FETCH_RESPONSE_TOO_LARGE",
        "robots.txt response exceeds configured size limit",
        { url, maxResponseBytes: maxBytes }
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
    if (size > maxBytes) {
      await reader.cancel();
      throw new SourceFetchError(
        "FETCH_RESPONSE_TOO_LARGE",
        "robots.txt response exceeds configured size limit",
        { url, maxResponseBytes: maxBytes }
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export function clearRobotsCache(): void {
  robotsCache.clear();
}
