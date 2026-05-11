export const DEFAULT_USER_AGENT = "FE-Radar Bot (+https://fe-radar.internal/bot)";

const REAL_BROWSER_USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
];

let index = 0;

export function acquireUserAgent(useRealUa = false): string {
  if (!useRealUa) {
    return DEFAULT_USER_AGENT;
  }

  const userAgent = REAL_BROWSER_USER_AGENTS[index % REAL_BROWSER_USER_AGENTS.length] ?? DEFAULT_USER_AGENT;
  index += 1;
  return userAgent;
}
