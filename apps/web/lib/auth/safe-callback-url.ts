/**
 * Same-site relative callbackUrl helpers for middleware and DingTalk in-app SSO.
 * Reject absolute URLs, protocol-relative URLs, and control characters.
 */

// Intentional: reject ASCII control characters in callbackUrl (NFR-01).
// eslint-disable-next-line no-control-regex -- security filter for callback paths
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * Normalize a candidate callback to a same-site relative path (pathname + optional query).
 * Invalid values fall back to `/`.
 */
export function normalizeSafeCallbackUrl(raw: string | null | undefined): string {
  if (raw == null || typeof raw !== "string") {
    return "/";
  }

  const trimmed = raw.trim();
  if (!trimmed || CONTROL_CHARS.test(trimmed)) {
    return "/";
  }

  // Absolute or scheme-based URLs (https:, javascript:, data:, …)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return "/";
  }

  // Protocol-relative (//evil.example) or backslash tricks
  if (trimmed.startsWith("//") || trimmed.includes("\\")) {
    return "/";
  }

  // Must be a single-leading-slash relative path
  if (!trimmed.startsWith("/")) {
    return "/";
  }

  return trimmed;
}

/** Build callback from pathname + search (search may include leading `?`). */
export function buildSafeCallbackUrl(pathname: string, search = ""): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const query =
    !search || search === "?"
      ? ""
      : search.startsWith("?")
        ? search
        : `?${search}`;
  return normalizeSafeCallbackUrl(`${path}${query}`);
}

/** Detect DingTalk client User-Agent (mobile / desktop). */
export function isDingTalkUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  return /DingTalk/i.test(ua);
}
