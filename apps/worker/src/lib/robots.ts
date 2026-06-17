import robotsParser from "robots-parser";
import { createLogger, SourceFetchError } from "@fe-radar/shared";
import { DEFAULT_USER_AGENT } from "./ua-pool";

const logger = createLogger({ service: "robots" });

interface RobotsCacheEntry {
  expiresAt: number;
  parser: ReturnType<typeof robotsParser>;
}

const robotsCache = new Map<string, RobotsCacheEntry>();
const ROBOTS_CACHE_MS = 24 * 60 * 60 * 1000;

export async function assertRobotsAllowed(url: string, userAgent = DEFAULT_USER_AGENT, fetchImpl: typeof fetch = fetch): Promise<void> {
  const target = new URL(url);
  const parser = await getRobotsParser(target, fetchImpl);
  if (!parser.isAllowed(url, userAgent)) {
    throw new SourceFetchError("ROBOTS_DISALLOWED", `robots.txt disallows ${target.pathname}`, {
      origin: target.origin,
      path: target.pathname,
    });
  }
}

async function getRobotsParser(target: URL, fetchImpl: typeof fetch): Promise<ReturnType<typeof robotsParser>> {
  const origin = target.origin;
  const cached = robotsCache.get(origin);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.parser;
  }

  const robotsUrl = new URL("/robots.txt", origin).toString();
  // robots.txt 不可达时 fail-open（允许抓取），避免网络抖动导致整源失败；明确 Disallow 仍拦截。
  let body = "User-agent: *\nAllow: /";
  try {
    const response = await fetchImpl(robotsUrl, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      body = await response.text();
    } else {
      logger.warn({ origin, robotsUrl, status: response.status }, "robots.txt unavailable, fail-open");
    }
  } catch (error) {
    logger.warn({ error, origin }, "robots.txt fetch failed, fail-open");
  }

  const parser = robotsParser(robotsUrl, body);
  robotsCache.set(origin, { parser, expiresAt: Date.now() + ROBOTS_CACHE_MS });
  return parser;
}

export function clearRobotsCache(): void {
  robotsCache.clear();
}
