import robotsParser from "robots-parser";
import { DEFAULT_USER_AGENT } from "./ua-pool";

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
    throw new Error(`robots.txt disallows ${target.pathname}`);
  }
}

async function getRobotsParser(target: URL, fetchImpl: typeof fetch): Promise<ReturnType<typeof robotsParser>> {
  const origin = target.origin;
  const cached = robotsCache.get(origin);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.parser;
  }

  const robotsUrl = new URL("/robots.txt", origin).toString();
  let body = "";
  try {
    const response = await fetchImpl(robotsUrl, { signal: AbortSignal.timeout(3000) });
    body = response.ok ? await response.text() : "";
  } catch {
    body = "";
  }

  const parser = robotsParser(robotsUrl, body);
  robotsCache.set(origin, { parser, expiresAt: Date.now() + ROBOTS_CACHE_MS });
  return parser;
}

export function clearRobotsCache(): void {
  robotsCache.clear();
}
