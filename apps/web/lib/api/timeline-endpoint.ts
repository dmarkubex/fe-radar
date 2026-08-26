const FILTER_QUERY_KEYS = ["category", "circle", "tier", "alertType", "eventType"] as const;

export function canFetchTimeline(endpoint: string): boolean {
  const url = new URL(endpoint, "http://local.invalid");
  if (url.pathname === "/api/search") {
    return Boolean(url.searchParams.get("q")?.trim());
  }
  return true;
}

export function buildTimelineEndpoint(
  pathname: string,
  params: Pick<URLSearchParams, "get">
): string {
  const query = new URLSearchParams();
  const q = params.get("q")?.trim() ?? "";
  if (q) {
    query.set("q", q);
  }
  for (const key of FILTER_QUERY_KEYS) {
    const value = params.get(key);
    if (value) {
      query.set(key, value);
    }
  }
  const suffix = query.toString();
  const useSearch =
    pathname === "/search" || pathname.startsWith("/search/") || q.length > 0;
  const path = useSearch ? "/api/search" : "/api/timeline";
  return `${path}${suffix ? `?${suffix}` : ""}`;
}
